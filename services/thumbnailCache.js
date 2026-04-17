const MAX_CACHE_SIZE = 500;

class LRUCache {
    constructor(limit = MAX_CACHE_SIZE) {
        this.limit = limit;
        this.map = new Map();
    }

    get(key) {
        if (!this.map.has(key)) return null;

        const value = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, value);

        return value;
    }

    set(key, value) {
        if (this.map.has(key)) {
            this.map.delete(key);
        }

        this.map.set(key, value);

        if (this.map.size > this.limit) {
            const firstKey = this.map.keys().next().value;
            this.map.delete(firstKey);
        }
    }
}

const thumbnailCache = new LRUCache(500);
const inFlightCache = new Map();

function generateCacheKey(file) {
    const filePath = file.path
        .toLowerCase()
        .replace(/\\/g, '/');

    return `${filePath}_${file.size}_${file.lastModified}`;
}

module.exports = {
    thumbnailCache,
    inFlightCache,
    generateCacheKey
};