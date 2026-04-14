// 简化的模拟交易测试脚本
const fs = require('fs');
const vm = require('vm');

// 读取app.js文件
const appCode = fs.readFileSync('dist/app.js', 'utf8');

// 创建沙盒环境
const sandbox = {
    console,
    localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    },
    window: {
        onerror: (message, source, lineno, colno, error) => {
            console.error('[全局错误]', message, error);
            return true;
        },
        addEventListener: (event, callback) => {
            console.log('模拟addEventListener:', event);
        }
    },
    // 模拟fetch函数
    fetch: (url) => {
        console.log('模拟fetch:', url);
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([])
        });
    },
    // 模拟必要的全局函数
    markRecord: (id) => {
        console.log('标记记录:', id);
    },
    deleteRecord: (id) => {
        console.log('删除记录:', id);
    },
    // 模拟AbortController
    AbortController: function() {
        return {
            signal: {},
            abort: () => {}
        };
    },
    // 模拟setTimeout和clearTimeout
    setTimeout: (callback, delay) => {
        return setTimeout(callback, delay);
    },
    clearTimeout: (timeoutId) => {
        clearTimeout(timeoutId);
    },
    // 模拟Date
    Date: Date,
    // 模拟Math
    Math: Math
};

// 执行app.js代码
vm.createContext(sandbox);
try {
    vm.runInContext(appCode, sandbox);
    console.log('App.js加载成功');
    
    // 检查Simulator是否初始化
    let simulator = null;
    if (sandbox.Simulator) {
        simulator = sandbox.Simulator;
        console.log('直接找到Simulator对象');
    } else if (sandbox.window && sandbox.window.BTCSignal && sandbox.window.BTCSignal.Simulator) {
        simulator = sandbox.window.BTCSignal.Simulator;
        console.log('从window.BTCSignal找到Simulator对象');
    } else if (sandbox.BTCSignal && sandbox.BTCSignal.Simulator) {
        simulator = sandbox.BTCSignal.Simulator;
        console.log('从BTCSignal找到Simulator对象');
    }
    
    if (simulator && simulator.runSimulationTest) {
        console.log('开始运行模拟交易测试...');
        simulator.runSimulationTest().then(stats => {
            console.log('\n测试结果:');
            console.log(`交易总笔数: ${stats.totalTrades}`);
            console.log(`胜率: ${stats.winRate}%`);
            console.log(`总盈亏: $${stats.totalPnL}`);
            console.log(`总权益: $${stats.equity}`);
            if (stats.winRate >= 65) {
                console.log('✅ 胜率达标65%，可以进入下一步');
            } else {
                console.log('❌ 胜率未达标65%，需要优化策略');
            }
        }).catch(error => {
            console.error('测试失败:', error);
        });
    } else {
        console.error('Simulator未初始化');
        console.log('sandbox.Simulator:', sandbox.Simulator);
        console.log('sandbox.window.BTCSignal:', sandbox.window ? sandbox.window.BTCSignal : 'window not found');
        console.log('sandbox.BTCSignal:', sandbox.BTCSignal);
    }
} catch (error) {
    console.error('加载app.js失败:', error);
}