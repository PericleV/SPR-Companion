    computeSingleMetric(metric, response, layers) {
        const { type, xMin, xMax, deltaN } = metric;
        let xArr = response.x;
        
        let startIndex = 0;
        let endIndex = xArr.length - 1;

        if (typeof xMin !== 'undefined' && typeof xMax !== 'undefined') {
            const numXMin = Number(xMin);
            const numXMax = Number(xMax);
            for (let i = 0; i < xArr.length; i++) {
                if (xArr[i] >= numXMin) { startIndex = i; break; }
            }
            for (let i = xArr.length - 1; i >= 0; i--) {
                if (xArr[i] <= numXMax) { endIndex = i; break; }
            }
        }
        
        xArr = xArr.subarray(startIndex, endIndex + 1);
        const subRes = {
            x: xArr,
            R: response.R.subarray(startIndex, endIndex + 1),
            T: response.T.subarray(startIndex, endIndex + 1),
            A: response.A.subarray(startIndex, endIndex + 1),
            phaseR: response.phaseR.subarray(startIndex, endIndex + 1),
            phaseT: response.phaseT.subarray(startIndex, endIndex + 1)
        };

        if (xArr.length === 0) return 999;
        
        if (type === 'curvefit') {
            let error = 0;
            const targetParam = metric.curvefitParam || 'R';
            const targetArr = subRes[targetParam] || subRes.R; 
            const targetComponents = (this.config.targetComponentsMap && this.config.targetComponentsMap[metric.id]) ? this.config.targetComponentsMap[metric.id] : [];

            for (let i = 0; i < xArr.length; i++) {
                const currentX = xArr[i];
                const targetY = evaluateTargetModel(currentX, targetComponents);
                error += Math.pow(targetArr[i] - targetY, 2);
            }
            return error / xArr.length;
        }
        
        if (type === 'FWHM') {
            const yArr = subRes.R;
            const minVal = Math.min(...yArr);
            const minIdx = yArr.indexOf(minVal);
            const baseline = Math.max(...yArr);
            const halfMax = minVal + (baseline - minVal) / 2;
            
            let leftX = xArr[0], rightX = xArr[xArr.length-1];
            for (let i = minIdx; i >= 0; i--) if (yArr[i] > halfMax) { leftX = xArr[i]; break; }
            for (let i = minIdx; i < yArr.length; i++) if (yArr[i] > halfMax) { rightX = xArr[i]; break; }
            return rightX - leftX;
        }

        if (type === 'BandCenter') {
            const yArr = subRes.R;
            const maxVal = Math.max(...yArr);
            const maxIdx = yArr.indexOf(maxVal);
            return xArr[maxIdx];
        }

        if (type === 'BandgapWidth') {
            const yArr = subRes.R;
            const maxVal = Math.max(...yArr);
            const maxIdx = yArr.indexOf(maxVal);
            const baseline = Math.min(...yArr);
            const halfMax = baseline + (maxVal - baseline) / 2;
            
            let leftX = xArr[0], rightX = xArr[xArr.length-1];
            for (let i = maxIdx; i >= 0; i--) if (yArr[i] < halfMax) { leftX = xArr[i]; break; }
            for (let i = maxIdx; i < yArr.length; i++) if (yArr[i] < halfMax) { rightX = xArr[i]; break; }
            return rightX - leftX;
        }

        const findTrueMin = (xA, yA) => {
            let minIdx = 0, minVal = Infinity;
            for (let i = 0; i < yA.length; i++) {
                if (Number.isFinite(yA[i]) && yA[i] < minVal) { minVal = yA[i]; minIdx = i; }
            }
            if (minIdx === 0 || minIdx === yA.length - 1) return xA[minIdx];
            const x0 = xA[minIdx], dx = xA[minIdx] - xA[minIdx - 1];
            const y_1 = yA[minIdx - 1], y0 = yA[minIdx], y1 = yA[minIdx + 1];
            const denom = y1 - 2 * y0 + y_1;
            return denom === 0 ? x0 : x0 - (dx / 2) * ((y1 - y_1) / denom);
        };

        if (type === 'Sensitivity') {
            const x1 = findTrueMin(subRes.x, subRes.R);
            const targetLayerIdx = typeof metric.layerIdx !== 'undefined' ? metric.layerIdx : layers.length - 1; 
            const sensResponse = this.runSimulationSequence(layers, this.config.sim, { layerIdx: targetLayerIdx, deltaN: deltaN });
            
            // Re-apply interval for sensitivity response to ensure valid comparison
            const sSubX = sensResponse.x.subarray(startIndex, endIndex + 1);
            const sSubR = sensResponse.R.subarray(startIndex, endIndex + 1);
            const x2 = findTrueMin(sSubX, sSubR);
            
            return Math.abs((x2 - x1) / deltaN);
        }

        if (type === 'FOM') {
            const yArr = subRes.R;
            const minVal = Math.min(...yArr);
            const minIdx = yArr.indexOf(minVal);
            const baseline = Math.max(...yArr);
            const halfMax = minVal + (baseline - minVal) / 2;
            
            let leftX = xArr[0], rightX = xArr[xArr.length-1];
            for (let i = minIdx; i >= 0; i--) if (yArr[i] > halfMax) { leftX = xArr[i]; break; }
            for (let i = minIdx; i < yArr.length; i++) if (yArr[i] > halfMax) { rightX = xArr[i]; break; }
            const fwhm = rightX - leftX;

            const x1 = xArr[minIdx];
            const sensLayers = JSON.parse(JSON.stringify(layers));
            const targetLayerIdx = typeof metric.layerIdx !== 'undefined' ? metric.layerIdx : sensLayers.length - 1; 
            const baseNk = evaluateLayersDispersion([layers[targetLayerIdx]], this.config.sim.fixed, this.config.materialsDB)[0];
            
            sensLayers[targetLayerIdx].type = 'standard';
            sensLayers[targetLayerIdx].material = '_TEMP_SENS_';
            this.config.materialsDB['_TEMP_SENS_'] = { type: 'constant', n: baseNk.n + deltaN, k: baseNk.k };

            const sensResponse = this.runSimulationSequence(sensLayers, this.config.sim);
            const sSubX = sensResponse.x.subarray(startIndex, endIndex + 1);
            const sSubR = sensResponse.R.subarray(startIndex, endIndex + 1);
            const minIdx2 = sSubR.indexOf(Math.min(...sSubR));
            const x2 = sSubX[minIdx2];
            
            const sensitivity = Math.abs((x2 - x1) / deltaN);
            return fwhm > 0 ? sensitivity / fwhm : 0;
        }

        if (type === 'ResonancePosition') {
            const minIdx = subRes.R.indexOf(Math.min(...subRes.R));
            return xArr[minIdx];
        }

        if (type.startsWith('MaxPhaseDerivative')) {
            const param = type.replace('MaxPhaseDerivative', '');
            const phaseArr = subRes['phase' + param];
            if (!phaseArr) return 0;
            
            let maxDerivative = 0;
            for (let i = 1; i < xArr.length - 1; i++) {
                const dx = xArr[i+1] - xArr[i-1];
                if (dx === 0) continue;
                let dPhase = phaseArr[i+1] - phaseArr[i-1];
                if (dPhase > 180) dPhase -= 360;
                else if (dPhase < -180) dPhase += 360;
                
                const derivative = Math.abs(dPhase / dx);
                if (derivative > maxDerivative) maxDerivative = derivative;
            }
            return maxDerivative;
        }

        if (type.startsWith('Average')) {
            const param = type.replace('Average', '');
            const yArr = subRes[param];
            let sum = 0;
            for (let i = 0; i < yArr.length; i++) sum += yArr[i];
            return sum / yArr.length;
        }

        const yArr = subRes[type];
        if (!yArr) return 999;
        return Math.min(...yArr);
    }
