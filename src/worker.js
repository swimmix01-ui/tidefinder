import { simulateParticle } from "./modules/particles.js";
self.onmessage = ({ data }) => {
  const finalPoints = [];
  for (let p = 0; p < data.particleCount; p++) {
    finalPoints.push(simulateParticle(data));
    if (p % 50 === 0) self.postMessage({ type: "progress", done: p });
  }
  self.postMessage({ type: "done", finalPoints });
};
