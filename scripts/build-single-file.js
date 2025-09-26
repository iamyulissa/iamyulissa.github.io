#!/usr/bin/env node

/**
 * 单文件构建脚本
 * 将整个应用打包为一个独立的HTML文件
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 开始单文件构建...');
console.log('===========================================');

// 1. 首先运行环境变量注入
console.log('📋 第一步: 注入环境变量...');
try {
    execSync('node scripts/build-env-inject.js', { stdio: 'inherit' });
    console.log('✅ 环境变量注入完成');
} catch (error) {
    console.error('❌ 环境变量注入失败:', error.message);
    process.exit(1);
}

// 2. 运行Vite构建
console.log('\n🔨 第二步: 运行Vite构建...');
try {
    execSync('npx vite build --config vite.config.js --logLevel info', { stdio: 'inherit' });
    console.log('✅ Vite构建完成');
} catch (error) {
    console.error('❌ Vite构建失败:', error.message);
    process.exit(1);
}

// 3. 检查构建结果
console.log('\n🔍 第三步: 验证构建结果...');
const distPath = path.join(process.cwd(), 'dist');
const indexPath = path.join(distPath, 'index.html');

if (!fs.existsSync(indexPath)) {
    console.error('❌ 构建文件不存在:', indexPath);
    process.exit(1);
}

const stats = fs.statSync(indexPath);
const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('✅ 构建验证完成');
console.log(`📦 单文件大小: ${fileSizeInMB} MB`);
console.log(`📂 输出位置: ${indexPath}`);

// 4. 可选：创建一个时间戳版本（可通过环境变量控制）
const createTimestampVersion = process.env.CREATE_TIMESTAMP !== 'false';

if (createTimestampVersion) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const timestampPath = path.join(distPath, `index-${timestamp}.html`);

    try {
        fs.copyFileSync(indexPath, timestampPath);
        console.log(`🕒 时间戳版本: ${timestampPath}`);
    } catch (error) {
        console.warn('⚠️ 创建时间戳版本失败:', error.message);
    }
} else {
    console.log('⏭️ 跳过时间戳版本创建');
}

console.log('\n🎉 单文件构建完成！');
console.log('===========================================');
console.log('📝 使用说明:');
console.log('   1. 打开浏览器');
console.log('   2. 拖拽 index.html 到浏览器窗口');
console.log('   3. 或者使用 file:// 协议打开文件');
console.log('');
console.log('⚠️  注意事项:');
console.log('   - 某些功能可能因CORS限制而受影响');
console.log('   - ServiceWorker已在单文件模式下禁用');
console.log('   - 建议在本地服务器环境下测试完整功能');