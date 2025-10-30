// compute cosine sim between two vectors (auto-normalizes inputs)
export function cosineSimilarity(a, b) {
    const va = normalizeEmbedding(a || []);
    const vb = normalizeEmbedding(b || []);
    const len = Math.min(va.length, vb.length);
    let dot = 0;
    for (let i = 0; i < len; i++) dot += va[i] * vb[i];
    return dot; // unit vectors → dot == cosine
}

export function sendMessageAsync(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(response);
        });
    });
}

// L2-normalize an embedding vector (returns a new array)
export function normalizeEmbedding(vec) {
    if (!Array.isArray(vec) || vec.length === 0) return vec || [];
    let sum = 0;
    for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
    const norm = Math.sqrt(sum) || 1;
    if (norm === 1) return vec.slice();
    const out = new Array(vec.length);
    for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
    return out;
}