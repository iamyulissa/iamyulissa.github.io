/**
 * API配置管理器
 * 支持多组API配置的增删改查和切换
 * 包含API Key使用统计功能
 * 遵循项目的IndexedDB存储规范
 */
class APIConfigManager {
    constructor() {
        this.dbName = 'WhaleLLTDB';
        this.dbVersion = 14; // 需要与主项目保持一致
        this.settingsStore = 'apiSettings'; // 统一使用apiSettings表存储所有配置
        // 不再使用实例变量存储db连接，直接使用window.db
        this.defaultConfigKey = 'settings'; // 默认配置使用'settings'键保持兼容性
        
        // 默认配置模板 - 移除模型字段
        this.defaultConfig = {
            id: '',
            name: '默认配置',
            url: '',
            key: '',
            contextMessageCount: 10,
            timeout: 60,
            isDefault: false,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        // 全局模型配置键
        this.globalModelConfigKey = 'global_model_config';
        
        // 当前激活的配置ID
        this.activeConfigId = null;
        this.availableModels = new Map(); // 缓存每个配置的可用模型列表
        
        // API Key统计功能
        this.statsStorageKey = 'apiKeyUsageStats';
        // console.log(`[API统计调试] APIConfigManager构造函数被调用，statsStorageKey=${this.statsStorageKey}`);
        this.stats = this.loadStats();
        // console.log(`[API统计调试] 构造函数中加载的stats:`, JSON.stringify(this.stats, null, 2));
        this.cleanupInterval = null;
    }

    /**
     * 初始化配置管理器
     */
    async init() {
        return await ensureDBReady(async () => {
            // 不再缓存 window.db，直接使用全局变量
            await this.migrateExistingConfig();
            await this.loadActiveConfig();

            // 初始化全局模型配置
            await this.initGlobalModelConfig();

            // 启动统计功能
            this.startAutoCleanup();
            console.log('API配置管理器初始化完成');
            return { success: true };
        }, 'API配置管理器初始化');
    }

    /**
     * 初始化多配置系统，不需要迁移，直接复用现有settings
     */
    async migrateExistingConfig() {
        try {
            const transaction = window.db.transaction([this.settingsStore], 'readonly');
            const store = transaction.objectStore(this.settingsStore);
            const existingSettings = await promisifyRequest(store.get(this.defaultConfigKey), '检查现有API设置');
            
            if (existingSettings && existingSettings.url && existingSettings.key) {
                // 为现有settings添加多配置系统需要的元数据
                const enhancedSettings = {
                    ...existingSettings,
                    configName: '默认配置',
                    isDefault: true,
                    createdAt: existingSettings.createdAt || Date.now(),
                    updatedAt: Date.now()
                };
                
                // 更新现有settings以包含多配置元数据
                const writeTransaction = window.db.transaction([this.settingsStore], 'readwrite');
                const writeStore = writeTransaction.objectStore(this.settingsStore);
                await promisifyRequest(writeStore.put(enhancedSettings), '增强现有配置');
                
                // 设置为当前激活配置
                this.activeConfigId = this.defaultConfigKey;
                await this.saveActiveConfigId(this.defaultConfigKey);
                console.log('现有配置已增强为多配置系统');
            }
        } catch (error) {
            console.log('配置初始化跳过（可能是新安装）:', error.message);
        }
    }

    /**
     * 生成新的配置ID
     */
    generateConfigId() {
        return 'config_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * 判断是否为配置键
     */
    isConfigKey(key) {
        return key === this.defaultConfigKey || key.startsWith('config_');
    }

    /**
     * 获取所有配置
     */
    async getAllConfigs() {
        return await ensureDBReady(async () => {
            const transaction = window.db.transaction([this.settingsStore], 'readonly');
            const store = transaction.objectStore(this.settingsStore);
            const allItems = await promisifyRequest(store.getAll(), '获取所有API配置');
            
            // 筛选出配置项并添加configId字段
            const configs = allItems
                .filter(item => this.isConfigKey(item.id))
                .map(item => ({
                    ...item,
                    configId: item.id,
                    configName: item.configName || (item.id === this.defaultConfigKey ? '默认配置' : '未命名配置')
                }))
                .sort((a, b) => {
                    // 默认配置排在最前
                    if (a.id === this.defaultConfigKey) return -1;
                    if (b.id === this.defaultConfigKey) return 1;
                    return (b.updatedAt || 0) - (a.updatedAt || 0);
                });
            
            return configs;
        }, '获取所有API配置');
    }

    /**
     * 根据ID获取配置
     */
    async getConfigById(id) {
        return await ensureDBReady(async () => {
            const transaction = window.db.transaction([this.settingsStore], 'readonly');
            const store = transaction.objectStore(this.settingsStore);
            const config = await promisifyRequest(store.get(id), '获取API配置');
            if (config && this.isConfigKey(id)) {
                return {
                    ...config,
                    configId: id,
                    configName: config.configName || (id === this.defaultConfigKey ? '默认配置' : '未命名配置')
                };
            }
            return null;
        }, '获取指定API配置');
    }

    /**
     * 保存配置
     */
    async saveConfig(config) {
        return await ensureDBReady(async () => {
            const now = Date.now();
            let configId = config.configId || config.id;
            
            if (!configId) {
                configId = this.generateConfigId();
            }
            
            // 使用传入的apiKeys结构，如果没有则构建默认结构
            let apiKeys;
            if (config.apiKeys && Array.isArray(config.apiKeys)) {
                // 使用前端传入的完整apiKeys结构
                apiKeys = config.apiKeys;
                console.log('[APIConfigManager] 使用前端传入的apiKeys结构，启用的key:', 
                    apiKeys.filter(k => k.enabled).map(k => `index${k.index}:${k.key.substring(0, 10)}...`));
            } else {
                // 兼容旧的additionalKeys格式
                apiKeys = [
                    {
                        key: config.key || '',
                        name: '主Key',
                        enabled: true,
                        index: 0
                    },
                    ...(config.additionalKeys || []).map((keyItem, index) => {
                        // 处理不同的数据格式：可能是字符串或对象
                        const keyValue = typeof keyItem === 'string' ? keyItem : (keyItem.key || keyItem);
                        const keyName = typeof keyItem === 'object' && keyItem.name ? keyItem.name : `Key ${index + 1}`;
                        const keyEnabled = typeof keyItem === 'object' && keyItem.enabled ? keyItem.enabled : false;
                        
                        return {
                            key: keyValue,
                            name: keyName,
                            enabled: keyEnabled,
                            index: index + 1
                        };
                    })
                ];
                console.log('[APIConfigManager] 使用兼容性apiKeys结构');
            }

            // API配置数据 - 仅保存连接相关信息
            const configData = {
                id: configId,
                url: config.url || '',
                key: config.key || '',
                contextMessageCount: config.contextMessageCount || 10,
                timeout: config.timeout || 60,
                apiKeys: apiKeys,
                configName: config.configName || config.name || '未命名配置',
                isDefault: config.isDefault || false,
                createdAt: config.createdAt || now,
                updatedAt: now
            };

            const transaction = window.db.transaction([this.settingsStore], 'readwrite');
            const store = transaction.objectStore(this.settingsStore);
            await promisifyRequest(store.put(configData), '保存API配置');
            
            // 清除该配置的模型缓存
            this.availableModels.delete(configId);
            
            console.log('API配置保存完成:', configData.configName);
            return configData;
        }, '保存API配置');
    }

    /**
     * 删除配置
     */
    async deleteConfig(id) {
        return await ensureDBReady(async () => {
            const config = await this.getConfigById(id);
            if (!config) {
                throw new Error('配置不存在');
            }
            
            if (id === this.defaultConfigKey) {
                throw new Error('不能删除默认配置');
            }

            const transaction = window.db.transaction([this.settingsStore], 'readwrite');
            const store = transaction.objectStore(this.settingsStore);
            await promisifyRequest(store.delete(id), '删除API配置');
            
            // 清除模型缓存
            this.availableModels.delete(id);
            
            // 如果删除的是当前激活配置，切换到默认配置
            if (this.activeConfigId === id) {
                const configs = await this.getAllConfigs();
                const defaultConfig = configs.find(c => c.id === this.defaultConfigKey);
                if (defaultConfig) {
                    await this.switchToConfig(this.defaultConfigKey);
                }
            }
            
            console.log('API配置删除完成:', config.configName || config.name);
            return true;
        }, '删除API配置');
    }

    /**
     * 切换到指定配置
     */
    async switchToConfig(configId) {
        const config = await this.getConfigById(configId);
        if (!config) {
            throw new Error('配置不存在');
        }

        this.activeConfigId = configId;
        await this.saveActiveConfigId(configId);
        
        // 更新全局apiSettings - 只包含API连接信息
        Object.assign(window.apiSettings, {
            url: config.url || '',
            key: this.getEnabledKey(config),
            contextMessageCount: config.contextMessageCount || 10,
            timeout: config.timeout || 60
        });

        // 清空全局模型配置，切换API配置时重置模型选择
        await this.clearGlobalModelConfig();

        // 触发配置切换事件
        window.dispatchEvent(new CustomEvent('apiConfigChanged', {
            detail: { configId, config }
        }));
        
        console.log('已切换到配置:', config.configName || config.name);
        return config;
    }

    /**
     * 获取当前激活的配置
     */
    async getActiveConfig() {
        if (this.activeConfigId) {
            return await this.getConfigById(this.activeConfigId);
        }
        
        // 如果没有激活配置，尝试获取默认配置
        const configs = await this.getAllConfigs();
        const defaultConfig = configs.find(c => c.id === this.defaultConfigKey) || configs[0];
        
        if (defaultConfig) {
            await this.switchToConfig(defaultConfig.id);
            return defaultConfig;
        }
        
        return null;
    }

    /**
     * 测试配置连接并缓存可用模型
     */
    async testConfigConnection(configId) {
        const config = await this.getConfigById(configId);
        if (!config || !config.url || !config.key) {
            throw new Error('配置不完整');
        }

        try {
            const data = await window.apiService.testConnection(config.url, config.key);
            const models = data.data ? data.data.map(m => m.id).sort() : [];
            
            // 缓存模型列表
            this.availableModels.set(configId, models);
            
            return { success: true, models, config };
        } catch (error) {
            throw new Error(`连接测试失败: ${error.message}`);
        }
    }

    /**
     * 获取配置的可用模型列表
     */
    async getConfigModels(configId) {
        // 先检查缓存
        if (this.availableModels.has(configId)) {
            return this.availableModels.get(configId);
        }

        // 如果没有缓存，测试连接获取
        try {
            const result = await this.testConfigConnection(configId);
            return result.models;
        } catch (error) {
            console.warn('获取模型列表失败:', error.message);
            return [];
        }
    }

    /**
     * 获取配置中启用的key
     */
    getEnabledKey(config) {
        if (!config.apiKeys || config.apiKeys.length === 0) {
            return config.key || '';
        }
        
        const enabledKey = config.apiKeys.find(k => k.enabled);
        return enabledKey ? enabledKey.key : (config.key || '');
    }

    /**
     * 设置配置中的key启用状态
     */
    async setKeyEnabled(configId, keyIndex, enabled) {
        return await ensureDBReady(async () => {
            const config = await this.getConfigById(configId);
            if (!config || !config.apiKeys || keyIndex >= config.apiKeys.length) {
                throw new Error('配置或key不存在');
            }

            if (enabled) {
                // 启用指定key，禁用其他key
                config.apiKeys.forEach((key, index) => {
                    key.enabled = (index === keyIndex);
                });
            } else {
                // 禁用指定key
                config.apiKeys[keyIndex].enabled = false;
                // 如果禁用的是当前启用的key，启用第一个可用的key
                const hasEnabledKey = config.apiKeys.some(k => k.enabled);
                if (!hasEnabledKey && config.apiKeys.length > 0) {
                    config.apiKeys[0].enabled = true;
                }
            }

            config.updatedAt = Date.now();
            const transaction = window.db.transaction([this.settingsStore], 'readwrite');
            const store = transaction.objectStore(this.settingsStore);
            await promisifyRequest(store.put(config), '更新key启用状态');

            // 如果是当前激活的配置，更新全局apiSettings
            if (this.activeConfigId === configId) {
                const enabledKey = this.getEnabledKey(config);
                window.apiSettings.key = enabledKey;
            }

            return config;
        }, '设置key启用状态');
    }

    /**
     * 添加新的key到配置
     */
    async addKeyToConfig(configId, keyValue, keyName) {
        return await ensureDBReady(async () => {
            const config = await this.getConfigById(configId);
            if (!config) {
                throw new Error('配置不存在');
            }

            if (!config.apiKeys) {
                config.apiKeys = [];
            }

            const newIndex = config.apiKeys.length;
            config.apiKeys.push({
                key: keyValue,
                name: keyName || `Key ${newIndex + 1}`,
                enabled: false,
                index: newIndex
            });

            config.updatedAt = Date.now();
            const transaction = window.db.transaction([this.settingsStore], 'readwrite');
            const store = transaction.objectStore(this.settingsStore);
            await promisifyRequest(store.put(config), '添加新key');

            return config;
        }, '添加新key');
    }

    /**
     * 从配置中删除key
     */
    async removeKeyFromConfig(configId, keyIndex) {
        return await ensureDBReady(async () => {
            const config = await this.getConfigById(configId);
            if (!config || !config.apiKeys || keyIndex >= config.apiKeys.length) {
                throw new Error('配置或key不存在');
            }

            // 不能删除最后一个key
            if (config.apiKeys.length <= 1) {
                throw new Error('至少需要保留一个key');
            }

            const removedKey = config.apiKeys[keyIndex];
            config.apiKeys.splice(keyIndex, 1);

            // 重新设置index
            config.apiKeys.forEach((key, index) => {
                key.index = index;
            });

            // 如果删除的是启用的key，启用第一个key
            if (removedKey.enabled && config.apiKeys.length > 0) {
                config.apiKeys[0].enabled = true;
            }

            config.updatedAt = Date.now();
            const transaction = window.db.transaction([this.settingsStore], 'readwrite');
            const store = transaction.objectStore(this.settingsStore);
            await promisifyRequest(store.put(config), '删除key');

            // 如果是当前激活的配置，更新全局apiSettings
            if (this.activeConfigId === configId) {
                const enabledKey = this.getEnabledKey(config);
                window.apiSettings.key = enabledKey;
            }

            return config;
        }, '删除key');
    }

    /**
     * 保存当前激活配置ID
     */
    async saveActiveConfigId(configId) {
        return await ensureDBReady(async () => {
            const transaction = window.db.transaction([this.settingsStore], 'readwrite');
            const store = transaction.objectStore(this.settingsStore);
            await promisifyRequest(store.put({ 
                id: 'activeConfigId', 
                value: configId,
                updatedAt: Date.now()
            }), '保存当前配置ID');
        }, '保存当前配置ID');
    }

    /**
     * 加载当前激活配置ID
     */
    async loadActiveConfig() {
        return await ensureDBReady(async () => {
            const transaction = window.db.transaction([this.settingsStore], 'readonly');
            const store = transaction.objectStore(this.settingsStore);
            const result = await promisifyRequest(store.get('activeConfigId'), '加载当前配置ID');
            
            if (result && result.value) {
                this.activeConfigId = result.value;
            }
        }, '加载当前配置ID');
    }

    /**
     * 复制配置
     */
    async duplicateConfig(id) {
        const originalConfig = await this.getConfigById(id);
        if (!originalConfig) {
            throw new Error('源配置不存在');
        }

        const duplicatedConfig = {
            ...originalConfig,
            configId: undefined, // 将生成新ID
            configName: (originalConfig.configName || originalConfig.name || '未命名配置') + ' - 副本',
            isDefault: false,
            createdAt: undefined,
            updatedAt: undefined
        };

        return await this.saveConfig(duplicatedConfig);
    }

    // ========== 全局模型配置管理 ==========

    /**
     * 保存全局模型配置
     */
    async saveGlobalModelConfig(modelConfig) {
        return await ensureDBReady(async () => {
            const transaction = window.db.transaction([this.settingsStore], 'readwrite');
            const store = transaction.objectStore(this.settingsStore);

            const globalModelData = {
                id: this.globalModelConfigKey,
                apiConfigId: modelConfig.apiConfigId || '',
                primaryModel: modelConfig.primaryModel || '',
                secondaryModel: modelConfig.secondaryModel || '',
                updatedAt: Date.now()
            };

            await promisifyRequest(store.put(globalModelData), '保存全局模型配置');

            // 更新全局变量
            if (!window.modelSettings) {
                window.modelSettings = {};
            }
            window.modelSettings.apiConfigId = globalModelData.apiConfigId;
            window.modelSettings.primaryModel = globalModelData.primaryModel;
            window.modelSettings.secondaryModel = globalModelData.secondaryModel;

            console.log('全局模型配置保存完成:', globalModelData);
            return globalModelData;
        }, '保存全局模型配置');
    }

    /**
     * 获取全局模型配置
     */
    async getGlobalModelConfig() {
        return await ensureDBReady(async () => {
            const transaction = window.db.transaction([this.settingsStore], 'readonly');
            const store = transaction.objectStore(this.settingsStore);
            const modelConfig = await promisifyRequest(store.get(this.globalModelConfigKey), '获取全局模型配置');

            if (modelConfig) {
                return {
                    apiConfigId: modelConfig.apiConfigId || '',
                    primaryModel: modelConfig.primaryModel || '',
                    secondaryModel: modelConfig.secondaryModel || ''
                };
            }

            // 返回默认空配置
            return {
                apiConfigId: '',
                primaryModel: '',
                secondaryModel: ''
            };
        }, '获取全局模型配置');
    }

    /**
     * 清空全局模型配置（切换API配置时调用）
     */
    async clearGlobalModelConfig() {
        await this.saveGlobalModelConfig({
            apiConfigId: '',
            primaryModel: '',
            secondaryModel: ''
        });
        console.log('全局模型配置已清空');
    }

    /**
     * 获取当前使用的完整API连接信息（结合API配置和模型配置）
     */
    async getCurrentApiConnection() {
        const modelConfig = await this.getGlobalModelConfig();

        if (!modelConfig.apiConfigId) {
            throw new Error('未设置全局模型配置');
        }

        const apiConfig = await this.getConfigById(modelConfig.apiConfigId);
        if (!apiConfig) {
            throw new Error('API配置不存在');
        }

        return {
            // API连接信息
            url: apiConfig.url,
            key: this.getEnabledKey(apiConfig),
            timeout: apiConfig.timeout || 60,
            contextMessageCount: apiConfig.contextMessageCount || 10,
            // 模型信息
            primaryModel: modelConfig.primaryModel,
            secondaryModel: modelConfig.secondaryModel,
            // 配置信息
            apiConfigId: modelConfig.apiConfigId,
            configName: apiConfig.configName
        };
    }

    /**
     * 初始化全局模型配置（应用启动时调用）
     */
    async initGlobalModelConfig() {
        try {
            const modelConfig = await this.getGlobalModelConfig();

            // 初始化全局modelSettings变量
            if (!window.modelSettings) {
                window.modelSettings = {};
            }

            window.modelSettings.apiConfigId = modelConfig.apiConfigId;
            window.modelSettings.primaryModel = modelConfig.primaryModel;
            window.modelSettings.secondaryModel = modelConfig.secondaryModel;

            console.log('全局模型配置初始化完成:', modelConfig);
        } catch (error) {
            console.warn('全局模型配置初始化失败:', error);
            // 初始化为空配置
            if (!window.modelSettings) {
                window.modelSettings = {
                    apiConfigId: '',
                    primaryModel: '',
                    secondaryModel: ''
                };
            }
        }
    }

    /**
     * 设置默认配置
     */
    async setDefaultConfig(id) {
        return await ensureDBReady(async () => {
            // 先取消所有配置的默认状态
            const configs = await this.getAllConfigs();
            const transaction = window.db.transaction([this.settingsStore], 'readwrite');
            const store = transaction.objectStore(this.settingsStore);
            
            for (const config of configs) {
                if (config.isDefault) {
                    config.isDefault = false;
                    await promisifyRequest(store.put(config), '更新配置默认状态');
                }
            }
            
            // 设置新的默认配置
            const targetConfig = configs.find(c => c.id === id);
            if (targetConfig) {
                targetConfig.isDefault = true;
                targetConfig.updatedAt = Date.now();
                await promisifyRequest(store.put(targetConfig), '设置默认配置');
            }
            
            console.log('默认配置已更新');
            return targetConfig;
        }, '设置默认配置');
    }

    // ========== API Key 使用统计功能 ==========

    /**
     * 从localStorage加载统计数据
     */
    loadStats() {
        try {
            // console.log(`[API统计调试] 从localStorage加载统计数据，storageKey=${this.statsStorageKey}`);
            const stored = localStorage.getItem(this.statsStorageKey);
            // console.log(`[API统计调试] localStorage中的原始数据:`, stored);
            if (stored) {
                const parsed = JSON.parse(stored);
                // console.log(`[API统计调试] 解析后的统计数据:`, JSON.stringify(parsed, null, 2));
                return parsed;
            } else {
                console.log(`[API统计调试] localStorage中没有找到统计数据`);
            }
        } catch (error) {
            console.warn('加载API Key统计失败:', error);
        }
        console.log(`[API统计调试] 返回默认统计数据`);
        return this.getDefaultStats();
    }

    /**
     * 获取默认的统计结构
     */
    getDefaultStats() {
        return {
            version: 1,
            lastCleanup: Date.now(),
            keyStats: {} // keyId -> { calls: [], totalCalls: number, successCalls: number }
        };
    }

    /**
     * 保存统计数据到localStorage
     */
    saveStats() {
        try {
            // console.log(`[API统计调试] 保存统计数据到localStorage:`, JSON.stringify(this.stats, null, 2));
            localStorage.setItem(this.statsStorageKey, JSON.stringify(this.stats));
            console.log(`[API统计调试] 保存成功`);
        } catch (error) {
            console.error('保存API Key统计失败:', error);
        }
    }

    /**
     * 记录一次API调用
     */
    recordCall(configId, keyIndex, keyValue, success = true) {
        // console.log(`[API统计调试] 记录API调用: configId=${configId}, keyIndex=${keyIndex}, success=${success}`);
        console.log(`[API统计调试] API Key前缀: ${keyValue.substring(0, 10)}...`);
        
        const keyId = this.generateKeyId(configId, keyIndex, keyValue);
        const now = Date.now();
                
        if (!this.stats.keyStats[keyId]) {
            this.stats.keyStats[keyId] = {
                configId,
                keyIndex,
                keyValueHash: this.hashKey(keyValue),
                calls: [],
                totalCalls: 0,
                successCalls: 0
            };
        }
        
        const keyStat = this.stats.keyStats[keyId];
        
        keyStat.calls.push({
            timestamp: now,
            success
        });
        
        keyStat.totalCalls++;
        if (success) {
            keyStat.successCalls++;
        }
                
        this.saveStats();
        
        window.dispatchEvent(new CustomEvent('apiKeyStatsUpdated', {
            detail: { keyId, stats: keyStat }
        }));
    }

    /**
     * 生成key的唯一ID
     */
    generateKeyId(configId, keyIndex, keyValue) {
        return `${configId}_${keyIndex}_${this.hashKey(keyValue)}`;
    }

    /**
     * 生成key的hash（用于安全存储）
     */
    hashKey(keyValue) {
        let hash = 0;
        for (let i = 0; i < keyValue.length; i++) {
            const char = keyValue.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * 获取指定key在近24小时内的调用统计
     */
    getKeyStats(configId, keyIndex, keyValue) {
        
        const keyId = this.generateKeyId(configId, keyIndex, keyValue);
        
        const keyStat = this.stats.keyStats[keyId];
        
        if (!keyStat) {
            console.log(`[API统计调试] 未找到统计记录，返回默认值`);
            return {
                totalCalls: 0,
                recentCalls: 0,
                successRate: 0
            };
        }
        
        const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recentCalls = keyStat.calls.filter(call => call.timestamp >= twentyFourHoursAgo);
        const recentSuccessCalls = recentCalls.filter(call => call.success);
        
        const result = {
            totalCalls: keyStat.totalCalls,
            recentCalls: recentCalls.length,
            recentSuccessCalls: recentSuccessCalls.length,
            successRate: recentCalls.length > 0 ? (recentSuccessCalls.length / recentCalls.length * 100).toFixed(1) : 0,
            lastUsed: recentCalls.length > 0 ? recentCalls[recentCalls.length - 1].timestamp : null
        };
        
        // console.log(`[API统计调试] 返回的统计结果:`, result);
        return result;
    }

    /**
     * 掩码显示Key（只显示前3位和后3位）
     */
    maskKey(keyValue) {
        // 确保keyValue是字符串
        if (typeof keyValue === 'object') {
            keyValue = keyValue.key || keyValue.toString();
        }
        
        if (typeof keyValue !== 'string') {
            keyValue = String(keyValue);
        }
        
        if (!keyValue || keyValue.length <= 8) {
            return '*'.repeat(keyValue.length || 8);
        }
        return keyValue.substring(0, 3) + '*'.repeat(keyValue.length - 6) + keyValue.substring(keyValue.length - 3);
    }

    /**
     * 清理超过24小时的记录
     */
    cleanup() {
        const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
        let cleanedCount = 0;
        
        for (const [keyId, keyStat] of Object.entries(this.stats.keyStats)) {
            const originalLength = keyStat.calls.length;
            keyStat.calls = keyStat.calls.filter(call => call.timestamp >= twentyFourHoursAgo);
            
            if (keyStat.calls.length < originalLength) {
                cleanedCount++;
                
                if (keyStat.calls.length === 0) {
                    keyStat.totalCalls = 0;
                    keyStat.successCalls = 0;
                } else {
                    keyStat.totalCalls = keyStat.calls.length;
                    keyStat.successCalls = keyStat.calls.filter(call => call.success).length;
                }
            }
        }
        
        if (cleanedCount > 0) {
            this.stats.lastCleanup = Date.now();
            this.saveStats();
            console.log(`API Key统计清理完成，清理了 ${cleanedCount} 个key的过期记录`);
        }
    }

    /**
     * 启动自动清理任务
     */
    startAutoCleanup() {
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60 * 60 * 1000); // 每小时清理一次
        
        this.cleanup(); // 立即执行一次清理
    }

    /**
     * 停止自动清理任务
     */
    stopAutoCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// 全局实例
window.apiConfigManager = new APIConfigManager();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = APIConfigManager;
}