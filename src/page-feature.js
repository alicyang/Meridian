export default class PageFeature {
    constructor(type, content, url, embedding = null) {
        this.type = type; 
        this.content = content;
        this.url = url; 
        this._embedding = embedding;
    }

    set embedding(embedding) {
        this._embedding = embedding;
    }

    toJSON() {
        return { type: this.type, data: this.data, url: this.url, embedding: this.embedding};
    }

    static fromJSON(obj) {
        return new PageFeature(obj.type, obj.data, obj.url, obj.embedding);
    }
}