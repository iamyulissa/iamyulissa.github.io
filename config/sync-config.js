/**
 * 云同步配置 - 自动检测部署环境
 */
class SyncConfig {
    /**
     * 获取API基础URL
     */
    static getApiBaseUrl() {
        // 如果在浏览器环境中
        if (typeof window !== 'undefined') {
            const hostname = window.location.hostname;
            
            // Vercel部署检测
            if (hostname.includes('.vercel.app') || hostname.includes('vercel')) {
                return ''; // 相对路径，使用当前域名的API
            }
            
            // Netlify部署检测 - 改为直接调用Vercel API
            if (hostname.includes('.netlify.app') || hostname.includes('netlify')) {
                // 直接使用生产环境Vercel域名，不再通过Netlify Functions代理
                return 'https://chat.whale-llt.top';
            }
            
            // 本地开发环境
            if (hostname === 'localhost' || hostname === '127.0.0.1') {
                // 如果是在Vercel Dev环境
                if (window.location.port === '3000') {
                    return ''; // 使用本地Vercel API
                }
                // 如果是其他本地环境，调用已部署的Vercel API
                return 'https://chat.whale-llt.top';
            }
            
            // 自定义域名 - 默认使用相对路径
            return '';
        }
        
        // Node.js环境（服务端）- 默认相对路径
        return '';
    }
    
    /**
     * 获取完整的API URL
     */
    static getApiUrl(endpoint) {
        const baseUrl = this.getApiBaseUrl();
        
        // 所有情况都使用标准API路径，不再使用Netlify函数代理
        return `${baseUrl}/api/sync/${endpoint}`;
    }
    
    /**
     * 检查当前是否为Vercel环境（有API能力）
     */
    static isVercelEnvironment() {
        if (typeof window !== 'undefined') {
            const hostname = window.location.hostname;
            return hostname.includes('.vercel.app') || 
                   hostname.includes('vercel') ||
                   (hostname === 'localhost' && window.location.port === '3000');
        }
        return false;
    }
    
    /**
     * 获取密钥生成器URL
     */
    static getKeyGeneratorUrl() {
        const baseUrl = this.getApiBaseUrl();
        return `${baseUrl}/sync-key-generator.html`;
    }
}
// 导出配置
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncConfig;
} else {
    window.SyncConfig = SyncConfig;
}