export default class PageFeature {
    constructor(type, content, url, embedding = null) {
        this.type = type; 
        this.content = content;
        this.url = url; 
        this._embedding = embedding;
    }

    get embedding() {
        return this._embedding;
    }

    set embedding(embedding) {
        this._embedding = embedding;
    }

    toJSON() {
        return { type: this.type, content: this.content, url: this.url, embedding: this._embedding };
    }

    static fromJSON(obj) {
        return new PageFeature(obj.type, obj.content, obj.url, obj.embedding);
    }
}