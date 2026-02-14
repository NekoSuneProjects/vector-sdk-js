export class MetadataConfig {
    constructor(name, displayName, about, picture, banner, nip05, lud16) {
        this.name = name;
        this.displayName = displayName;
        this.about = about;
        this.picture = picture;
        this.banner = banner;
        this.nip05 = nip05;
        this.lud16 = lud16;
    }
    build() {
        return {
            name: this.name,
            displayName: this.displayName,
            about: this.about,
            picture: this.picture,
            banner: this.banner,
            nip05: this.nip05,
            lud16: this.lud16,
            bot: true,
        };
    }
}
export class MetadataConfigBuilder {
    constructor() {
        this.config = {
            name: '',
            displayName: '',
            about: '',
        };
    }
    name(value) {
        this.config.name = value;
        return this;
    }
    displayName(value) {
        this.config.displayName = value;
        return this;
    }
    about(value) {
        this.config.about = value;
        return this;
    }
    picture(value) {
        this.config.picture = value;
        return this;
    }
    banner(value) {
        this.config.banner = value;
        return this;
    }
    nip05(value) {
        this.config.nip05 = value;
        return this;
    }
    lud16(value) {
        this.config.lud16 = value;
        return this;
    }
    build() {
        return new MetadataConfig(this.config.name, this.config.displayName, this.config.about, this.config.picture, this.config.banner, this.config.nip05, this.config.lud16).build();
    }
}
export function createMetadata(name, displayName, about, picture, banner, nip05, lud16) {
    return new MetadataConfig(name, displayName, about, picture, banner, nip05, lud16).build();
}
