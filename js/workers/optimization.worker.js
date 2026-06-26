import { GeneticOptimizer, ParticleSwarmOptimizer, GradientDescentOptimizer } from '../core/geneticAlgo.js?v=50';

// --- Handler Mesaje ---
// Worker-ul a devenit extrem de ușor. Preia configurația și lansează core-ul separat,
// pasându-i direct funcțiile de postMessage pentru comunicarea progresului și finalizării.
self.onmessage = function(e) {
    try {
        const config = e.data.config;
        if (config) {
            let optimizer;
            if (config.algoType === 'pso') {
                optimizer = new ParticleSwarmOptimizer(config, data => postMessage(data), data => postMessage(data));
            } else if (config.algoType === 'gd') {
                optimizer = new GradientDescentOptimizer(config, data => postMessage(data), data => postMessage(data));
            } else {
                optimizer = new GeneticOptimizer(config, data => postMessage(data), data => postMessage(data));
            }
            optimizer.run();
        }
    } catch (err) {
        postMessage({ type: 'error', message: err.message, stack: err.stack });
    }
};
