/**
 * 模型能力检测器
 * 用于检测AI模型是否支持图像视觉能力
 */
class ModelCapabilityDetector {
    constructor() {
        // 支持视觉能力的模型列表 - 使用关键词模糊匹配
        this.visionSupportedModels = [
            // OpenAI
            'chatgpt-4o-latest',
            'gpt-4-turbo',
            'gpt-4-vision',
            'gpt-4.1',
            'gpt-4.5-preview',
            'gpt-4o',
            'gpt-5',
            'o1',
            'o3',
            'o4-mini',
            // Claude
            'claude-3',
            'claude-opus-4',
            'claude-sonnet-4',
            // Cohere
            'c4ai-aya-vision',
            'command-a-vision',
            // Google AI Studio
            'gemini-1.5',
            'gemini-2.0',
            'gemini-2.5',
            'gemini-exp-1206',
            'learnlm',
            // MistralAI
            'mistral-small-2503',
            'mistral-small-2506',
            'mistral-small-latest',
            'mistral-medium-latest',
            'mistral-medium-2505',
            'mistral-medium-2508',
            'pixtral',
            // xAI (Grok)
            'grok-4',
            'grok-2-vision',
            'grok-vision',
            // Moonshot
            'moonshot-v1-8k-vision-preview',
            'moonshot-v1-32k-vision-preview',
            'moonshot-v1-128k-vision-preview',
        ];
        
        console.log(`[ModelCapabilityDetector] 初始化完成，支持 ${this.visionSupportedModels.length} 种视觉模型`);
    }

    /**
     * 检测模型是否支持图像视觉能力，返回匹配的模型或null
     * 使用模糊匹配：提取关键词（除标点），检查是否全部匹配
     * @param {string} modelName - 要检查的模型名称
     * @returns {string|null} 匹配的支持模型名称，如果不支持则返回null
     */
    _findMatchedVisionModel(modelName) {
        if (!modelName || typeof modelName !== 'string') {
            return null;
        }

        // 规范化输入的模型名称：转小写，提取关键词
        const inputKeywords = this.extractKeywords(modelName.toLowerCase());
        
        // 遍历支持的模型列表，进行模糊匹配
        for (const supportedModel of this.visionSupportedModels) {
            const supportedKeywords = this.extractKeywords(supportedModel.toLowerCase());
            
            // 检查支持模型的所有关键词是否都在输入模型中出现
            const isMatch = supportedKeywords.every(keyword => 
                inputKeywords.includes(keyword)
            );
            
            if (isMatch) {
                console.log(`[ModelCapabilityDetector] 模型 "${modelName}" 匹配到支持视觉的模型 "${supportedModel}"`);
                return supportedModel;
            }
        }
        
        console.log(`[ModelCapabilityDetector] 模型 "${modelName}" 不支持视觉能力`);
        return null;
    }

    /**
     * 检测模型是否支持图像视觉能力
     * @param {string} modelName - 要检查的模型名称
     * @returns {boolean} 是否支持视觉能力
     */
    supportsVision(modelName) {
        return this._findMatchedVisionModel(modelName) !== null;
    }

    /**
     * 提取关键词：移除标点符号，按分隔符拆分
     * @param {string} modelName - 模型名称
     * @returns {string[]} 关键词数组
     */
    extractKeywords(modelName) {
        // 移除常见标点符号，保留字母数字和连字符
        const cleaned = modelName.replace(/[^\w\-\.]/g, ' ');
        
        // 按空格、连字符、点号分割，过滤空字符串
        const keywords = cleaned
            .split(/[\s\-\.]+/)
            .filter(word => word.length > 0)
            .map(word => word.toLowerCase());
            
        return keywords;
    }

    /**
     * 获取所有支持视觉的模型列表
     * @returns {string[]} 支持视觉的模型列表
     */
    getSupportedVisionModels() {
        return [...this.visionSupportedModels];
    }

    /**
     * 检查模型名称并返回详细信息
     * @param {string} modelName - 模型名称
     * @returns {Object} 检查结果详情
     */
    checkModelCapability(modelName) {
        const matchedModel = this._findMatchedVisionModel(modelName);
        const supportsVision = matchedModel !== null;
        const inputKeywords = this.extractKeywords(modelName?.toLowerCase() || '');
        
        return {
            modelName: modelName || '',
            supportsVision,
            matchedModel,
            inputKeywords,
            supportedModelsCount: this.visionSupportedModels.length
        };
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModelCapabilityDetector;
} else {
    // 浏览器环境，挂载到window对象
    window.ModelCapabilityDetector = ModelCapabilityDetector;
}