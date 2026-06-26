import { GeometryManager } from './tab2Geometry.js?v=50';
import { MaterialsDB } from '../core/materials_database.js?v=50';
import { OptimizationManager } from './tab5Optimization.js?v=50';

export const WorkspaceManager = {
    
    init() {
        const btnSave = document.getElementById('btn-save-workspace');
        const btnLoad = document.getElementById('btn-load-workspace');
        const inputLoad = document.getElementById('input-load-workspace');

        if(btnSave) {
            btnSave.addEventListener('click', () => {
                this.exportWorkspace();
            });
        }

        if(btnLoad && inputLoad) {
            btnLoad.addEventListener('click', () => {
                inputLoad.click();
            });

            inputLoad.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if(!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.importWorkspace(ev.target.result);
                    // reset input
                    inputLoad.value = '';
                };
                reader.readAsText(file);
            });
        }
    },

    exportWorkspace() {
        const config = {
            geometry: {
                layers: GeometryManager.layers,
                isDBRActive: GeometryManager.isDBRActive,
                dbrParams: GeometryManager.dbrParams
            },
            materials: JSON.parse(localStorage.getItem('plasmonic_materials')) || {} // Save custom imported ones
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", "spr_geometry.json");
        dlAnchorElem.click();
    },

    importWorkspace(fileData) {
        try {
            const config = JSON.parse(fileData);

            // Restore Materials
            if (config.materials) {
                const currentSaved = JSON.parse(localStorage.getItem('plasmonic_materials')) || {};
                const newSaved = { ...currentSaved, ...config.materials };
                localStorage.setItem('plasmonic_materials', JSON.stringify(newSaved));
                Object.assign(MaterialsDB, config.materials);
                // The UI doesn't have a direct render function exposed here, but reloading the page or saving will keep them
            }

            // Restore Geometry
            if (config.geometry) {
                GeometryManager.layers = config.geometry.layers || [];
                GeometryManager.isDBRActive = config.geometry.isDBRActive || false;
                GeometryManager.dbrParams = config.geometry.dbrParams || GeometryManager.dbrParams;
                
                // Update DBR toggle switch in UI
                const dbrToggle = document.getElementById('geom-dbr-toggle');
                if(dbrToggle) dbrToggle.checked = GeometryManager.isDBRActive;
                
                if(typeof GeometryManager.renderLayers === 'function') {
                    GeometryManager.renderLayers();
                }
                
                // if there is a DBR builder render, call it too
                if(typeof GeometryManager.renderDBRBuilder === 'function') {
                    GeometryManager.renderDBRBuilder();
                }
            }

            // Optional: trigger simulation to plot the new geometry if we are on the sim tab
            if (typeof SimulationManager !== 'undefined' && SimulationManager.runSimulation) {
                setTimeout(() => {
                    SimulationManager.runSimulation();
                }, 100);
            }

            alert("Geometry configuration loaded successfully!");

        } catch (e) {
            console.error("Failed to load geometry config", e);
            alert("Error loading file. File might be corrupted.");
        }
    }
};
