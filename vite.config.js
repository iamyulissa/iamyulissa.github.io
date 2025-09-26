import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';

// Custom plugin to inline iframe content
function inlineIframePlugin() {
  return {
    name: 'inline-iframe',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        console.log(`[inline-iframe] 🚀 开始处理iframe内容`);

        const iframeMatches = html.match(/<iframe[^>]*?>/g);
        console.log(`[inline-iframe] 📊 发现 ${iframeMatches ? iframeMatches.length : 0} 个iframe标签`);

        // 查找所有 iframe 标签并处理
        return html.replace(/<iframe[^>]*?>/g, (iframeTag) => {
          const srcMatch = iframeTag.match(/src=(?:"([^"]*)"|'([^']*)')/);

          // 如果没有 src 属性，则返回原始标签
          if (!srcMatch) {
            console.log(`[inline-iframe] ⏭️ 跳过无src属性的iframe`);
            return iframeTag;
          }

          const src = srcMatch[1] || srcMatch[2];
          console.log(`[inline-iframe] 🔍 处理iframe: ${src}`);

          // 如果 src 为空或是外部链接，则返回原始标签
          if (!src || src.startsWith('http') || src.startsWith('//')) {
            console.log(`[inline-iframe] ⏭️ 跳过外部iframe: ${src}`);
            return iframeTag;
          }

          try {
            // 解析并读取 iframe 内容
            const iframePath = resolve(dirname(context.filename), src);
            console.log(`[inline-iframe] 📁 iframe文件路径: ${iframePath}`);

            if (!existsSync(iframePath)) {
              console.warn(`[inline-iframe] ❌ iframe文件不存在: ${iframePath}`);
              return iframeTag;
            }

            let iframeContent = readFileSync(iframePath, 'utf-8');
            console.log(`[inline-iframe] 📄 iframe文件大小: ${(iframeContent.length / 1024).toFixed(1)}KB`);

            // 在内联iframe内容之前，先处理其中的JavaScript引用
            iframeContent = inlineIframeJavaScript(iframeContent, dirname(iframePath));

            // 为 srcdoc 属性转义 HTML 内容（标准 HTML 实体转义）
            const escapedContent = iframeContent
              .replace(/&/g, '&amp;')      // 正确地将 '&' 转义为 '&amp;'
              .replace(/"/g, '&quot;')    // 为属性值转义双引号

            // 将 src 属性替换为 srcdoc（复用之前的匹配结果）
            return iframeTag.replace(srcMatch[0], `srcdoc="${escapedContent}"`);
          } catch (error) {
            console.warn(`[inline-iframe] 内联 ${src} 内容失败: ${error.message}`);
            return iframeTag; // 出错时返回原始标签
          }
        });
      }
    }
  };
}

// 辅助函数：处理iframe内容中的JavaScript引用
function inlineIframeJavaScript(htmlContent, iframeDir) {
  const projectRoot = resolve(process.cwd());
  console.log(`[inline-iframe-js] 🚀 开始处理iframe内容，iframe目录: ${iframeDir}`);

  const scriptMatches = htmlContent.match(/<script[^>]*src=["']([^"']*?)["'][^>]*><\/script>/g);
  console.log(`[inline-iframe-js] 📊 iframe中发现 ${scriptMatches ? scriptMatches.length : 0} 个script标签`);

  return htmlContent.replace(/<script[^>]*src=["']([^"']*?)["'][^>]*><\/script>/g, (scriptTag, src) => {
    console.log(`[inline-iframe-js] 🔍 处理iframe中的script: ${src}`);
    // 跳过外部链接
    if (src.startsWith('http') || src.startsWith('//') || src.startsWith('data:')) {
      return scriptTag;
    }

    try {
      // 处理带版本号的文件路径，去掉查询参数
      const cleanSrc = src.split('?')[0];

      // 解析文件路径
      let scriptPath;
      if (cleanSrc.startsWith('./') || cleanSrc.startsWith('../')) {
        scriptPath = resolve(iframeDir, cleanSrc);
      } else {
        scriptPath = resolve(projectRoot, cleanSrc);
      }

      // 检查文件是否存在
      if (!existsSync(scriptPath)) {
        console.warn(`[inline-iframe-js] iframe中的脚本文件不存在: ${scriptPath}`);
        return scriptTag;
      }

      // 读取 JavaScript 文件内容
      const jsContent = readFileSync(scriptPath, 'utf-8');
      console.log(`[inline-iframe-js] ✅ iframe内联文件: ${cleanSrc} (${(jsContent.length / 1024).toFixed(1)}KB)`);

      // 检查是否有 defer 或 async 属性
      const isDeferMatch = scriptTag.match(/\sdefer\s/);
      const isAsyncMatch = scriptTag.match(/\sasync\s/);

      let attributes = '';
      if (isDeferMatch) attributes += ' defer';
      if (isAsyncMatch) attributes += ' async';

      return `<script${attributes}>\n${jsContent}\n</script>`;
    } catch (error) {
      console.warn(`[inline-iframe-js] iframe中内联 ${src} 失败: ${error.message}`);
      return scriptTag;
    }
  });
}

// Custom plugin to inline JavaScript files
function inlineJavaScriptPlugin() {
  return {
    name: 'inline-javascript',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        const projectRoot = resolve(process.cwd());
        console.log(`[inline-javascript] 🚀 开始处理文件: ${context.filename}`);

        // 先统计一下有多少个script标签
        const scriptMatches = html.match(/<script[^>]*src=["']([^"']*?)["'][^>]*><\/script>/g);
        console.log(`[inline-javascript] 📊 发现 ${scriptMatches ? scriptMatches.length : 0} 个script标签`);
        if (scriptMatches) {
          scriptMatches.forEach((tag, index) => {
            const srcMatch = tag.match(/src=["']([^"']*?)["']/);
            if (srcMatch) {
              console.log(`[inline-javascript] 📄 第${index + 1}个: ${srcMatch[1]}`);
            }
          });
        }

        // 查找所有本地 script 标签并内联
        return html.replace(/<script[^>]*src=["']([^"']*?)["'][^>]*><\/script>/g, (scriptTag, src) => {
          console.log(`[inline-javascript] 🔍 处理script标签: ${src}`);
          // 跳过外部链接和已经有其他属性的脚本
          if (src.startsWith('http') || src.startsWith('//') || src.startsWith('data:')) {
            console.log(`[inline-javascript] ⏭️ 跳过外部链接: ${src}`);
            return scriptTag;
          }

          // 检查是否是 defer 或 async 脚本，保留这些属性
          const isDeferMatch = scriptTag.match(/\sdefer\s/);
          const isAsyncMatch = scriptTag.match(/\sasync\s/);
          const hasDataAttributes = scriptTag.match(/\sdata-[^=]*=/);

          // 如果是外部脚本服务（如 umami），保留原样
          if (hasDataAttributes) {
            console.log(`[inline-javascript] ⏭️ 跳过带data属性的脚本: ${src}`);
            return scriptTag;
          }

          try {
            // 处理带版本号的文件路径，去掉查询参数
            const cleanSrc = src.split('?')[0];
            console.log(`[inline-javascript] 🧹 清理后的路径: ${cleanSrc}`);

            // 解析文件路径
            let scriptPath;
            if (cleanSrc.startsWith('./') || cleanSrc.startsWith('../')) {
              scriptPath = resolve(dirname(context.filename), cleanSrc);
              console.log(`[inline-javascript] 📁 相对路径解析: ${scriptPath}`);
            } else {
              scriptPath = resolve(projectRoot, cleanSrc);
              console.log(`[inline-javascript] 📁 绝对路径解析: ${scriptPath}`);
            }

            // 检查文件是否存在
            if (!existsSync(scriptPath)) {
              console.warn(`[inline-javascript] ❌ 文件不存在: ${scriptPath}`);
              console.warn(`[inline-javascript] 🔍 项目根目录: ${projectRoot}`);
              console.warn(`[inline-javascript] 🔍 上下文文件: ${context.filename}`);
              console.warn(`[inline-javascript] 🔍 上下文目录: ${dirname(context.filename)}`);
              return scriptTag;
            }

            // 读取 JavaScript 文件内容
            const jsContent = readFileSync(scriptPath, 'utf-8');
            console.log(`[inline-javascript] ✅ 内联文件: ${cleanSrc} (${(jsContent.length / 1024).toFixed(1)}KB)`);

            // 构建内联脚本标签，保留 defer 和 async 属性
            let attributes = '';
            if (isDeferMatch) attributes += ' defer';
            if (isAsyncMatch) attributes += ' async';

            return `<script${attributes}>\n${jsContent}\n</script>`;
          } catch (error) {
            console.warn(`[inline-javascript] 内联 ${src} 失败: ${error.message}`);
            return scriptTag;
          }
        });
      }
    }
  };
}

// Custom plugin to inline static assets like icons
function inlineStaticAssetsPlugin() {
  return {
    name: 'inline-static-assets',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        const projectRoot = resolve(process.cwd());

        // 内联所有本地图标文件 - 处理 href 和 src 属性
        let result = html.replace(/(?:href|src)=["']([^"']*?\.(?:png|jpg|jpeg|gif|svg|ico))["']/g, (match, src) => {
          return inlineAsset(match, src, projectRoot, context);
        });

        // 特别处理 PWA 图标的 link 标签
        result = result.replace(/<link[^>]*(?:rel=["'](?:apple-touch-)?icon["']|rel=["']mask-icon["'])[^>]*>/g, (linkTag) => {
          const hrefMatch = linkTag.match(/href=["']([^"']*)["']/);
          if (!hrefMatch) return linkTag;

          const href = hrefMatch[1];
          const newMatch = inlineAsset(hrefMatch[0], href, projectRoot, context);
          return linkTag.replace(hrefMatch[0], newMatch);
        });

        return result;
      }
    }
  };
}

// 辅助函数：内联单个资源
function inlineAsset(match, src, projectRoot, context) {
  // 跳过外部链接
  if (src.startsWith('http') || src.startsWith('//') || src.startsWith('data:')) {
    return match;
  }

  try {
    // 解析文件路径
    let assetPath;
    if (src.startsWith('./') || src.startsWith('../')) {
      assetPath = resolve(dirname(context.filename), src);
    } else {
      assetPath = resolve(projectRoot, src);
    }

    // 检查文件是否存在
    if (!existsSync(assetPath)) {
      console.warn(`[inline-static-assets] 资源文件不存在: ${assetPath}`);
      return match;
    }

    // 读取文件并转为 base64
    const fileBuffer = readFileSync(assetPath);
    const base64Content = fileBuffer.toString('base64');

    // 获取 MIME 类型
    const ext = src.split('.').pop().toLowerCase();
    let mimeType;
    switch (ext) {
      case 'png': mimeType = 'image/png'; break;
      case 'jpg':
      case 'jpeg': mimeType = 'image/jpeg'; break;
      case 'gif': mimeType = 'image/gif'; break;
      case 'svg': mimeType = 'image/svg+xml'; break;
      case 'ico': mimeType = 'image/x-icon'; break;
      default: mimeType = 'application/octet-stream';
    }

    const dataUrl = `data:${mimeType};base64,${base64Content}`;
    return match.replace(src, dataUrl);
  } catch (error) {
    console.warn(`[inline-static-assets] 内联资源 ${src} 失败: ${error.message}`);
    return match;
  }
}

// Custom plugin to inline JSON files
function inlineJsonPlugin() {
  return {
    name: 'inline-json',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        const projectRoot = resolve(process.cwd());

        // 处理 manifest.json 等JSON文件
        return html.replace(/<link[^>]*rel=["']manifest["'][^>]*>/g, (linkTag) => {
          const hrefMatch = linkTag.match(/href=["']([^"']*)["']/);
          if (!hrefMatch) return linkTag;

          const href = hrefMatch[1];
          if (href.startsWith('http') || href.startsWith('//')) {
            return linkTag;
          }

          try {
            let jsonPath;
            if (href.startsWith('./') || href.startsWith('../')) {
              jsonPath = resolve(dirname(context.filename), href);
            } else {
              jsonPath = resolve(projectRoot, href);
            }

            if (!existsSync(jsonPath)) {
              console.warn(`[inline-json] 文件不存在: ${jsonPath}`);
              return linkTag;
            }

            const jsonContent = readFileSync(jsonPath, 'utf-8');
            const base64Content = Buffer.from(jsonContent).toString('base64');
            const dataUrl = `data:application/json;base64,${base64Content}`;

            return linkTag.replace(hrefMatch[0], `href="${dataUrl}"`);
          } catch (error) {
            console.warn(`[inline-json] 内联 ${href} 失败: ${error.message}`);
            return linkTag;
          }
        });
      }
    }
  };
}


// Custom plugin to disable ServiceWorker for single file build
function disableServiceWorkerPlugin() {
  return {
    name: 'disable-service-worker',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        // 更精确地禁用 ServiceWorker 注册代码
        let result = html;

        // 第一步：处理简单的内联script中的serviceWorker代码
        result = result.replace(
          /<script[^>]*>[\s\S]*?if\s*\(\s*['"]serviceWorker['"] in navigator\s*\)\s*{[\s\S]*?}<\/script>/g,
          `<script>
    console.log('ServiceWorker disabled in single-file mode');
</script>`
        );

        // 第二步：处理独立的registerServiceWorker函数
        result = result.replace(
          /function\s+registerServiceWorker\s*\(\s*\)\s*{[\s\S]*?(?=^function|\n\/\*\*|\nfunction|\n\s*$|\n\s*\/\/)/gm,
          `function registerServiceWorker() {
    console.log('ServiceWorker disabled in single-file mode');
}

`
        );

        // 第三步：处理navigator.serviceWorker.addEventListener调用 - 需要处理完整的代码块
        result = result.replace(
          /navigator\.serviceWorker\.addEventListener\([^}]*\{[^}]*\}\);?/g,
          `// ServiceWorker event listener disabled in single-file mode`
        );

        // 处理更复杂的addEventListener结构
        result = result.replace(
          /navigator\.serviceWorker\.addEventListener\([^}]*\{[\s\S]*?\}\s*\);?/g,
          `// ServiceWorker event listener disabled in single-file mode`
        );

        // 第四步：处理SystemUtils.registerServiceWorker调用
        result = result.replace(
          /window\.SystemUtils\.registerServiceWorker\(\);?/g,
          `console.log('SystemUtils.registerServiceWorker disabled in single-file mode');`
        );

        // 第五步：处理残留的 ServiceWorker 注册代码
        result = result.replace(
          /ServiceWorker registration failed:/g,
          `ServiceWorker disabled in single-file mode:`
        );

        // 第六步：处理完整的ServiceWorker代码块（包括嵌套结构）
        result = result.replace(
          /if\s*\(\s*['"]serviceWorker['"] in navigator\s*\)\s*{[\s\S]*?^\}/gm,
          `console.log('ServiceWorker disabled in single-file mode');`
        );

        // 处理任何残留的ServiceWorker事件监听器代码块
        result = result.replace(
          /\/\/ 🔥 监听来自 Service Worker 的缓存清理消息[\s\S]*?(?=\/\/|function|\n\s*$)/g,
          `// ServiceWorker monitoring disabled in single-file mode\n`
        );

        return result;
      }
    }
  };
}

// Custom plugin to inline CSS files
function inlineCssPlugin() {
  return {
    name: 'inline-css',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        const projectRoot = resolve(process.cwd());

        // 内联CSS文件
        return html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/g, (linkTag) => {
          const hrefMatch = linkTag.match(/href=["']([^"']*)["']/);
          if (!hrefMatch) return linkTag;

          const href = hrefMatch[1];
          if (href.startsWith('http') || href.startsWith('//') || href.startsWith('data:')) {
            return linkTag;
          }

          try {
            let cssPath;
            if (href.startsWith('./') || href.startsWith('../')) {
              cssPath = resolve(dirname(context.filename), href);
            } else {
              cssPath = resolve(projectRoot, href);
            }

            if (!existsSync(cssPath)) {
              console.warn(`[inline-css] 文件不存在: ${cssPath}`);
              return linkTag;
            }

            const cssContent = readFileSync(cssPath, 'utf-8');
            return `<style>\n${cssContent}\n</style>`;
          } catch (error) {
            console.warn(`[inline-css] 内联 ${href} 失败: ${error.message}`);
            return linkTag;
          }
        });
      }
    }
  };
}

export default defineConfig({
  plugins: [
    inlineJavaScriptPlugin(),
    inlineStaticAssetsPlugin(),
    inlineJsonPlugin(),
    inlineCssPlugin(),
    disableServiceWorkerPlugin(),
    inlineIframePlugin(),
    viteSingleFile()
  ],
  build: {
    rollupOptions: {
      input: 'index.html',
      output: {
        dir: 'dist',
        // 移除assets文件夹的配置，让viteSingleFile插件完全控制输出
        inlineDynamicImports: true
      }
    },
    // Inline all assets including CSS and JS
    assetsInlineLimit: 100000000, // Very large limit to inline everything
    cssCodeSplit: false,
    // 确保所有资源都被内联
    minify: false // 可选：关闭压缩以便调试
  },
  // Don't process node_modules since this is a frontend-only build
  optimizeDeps: {
    include: []
  }
});