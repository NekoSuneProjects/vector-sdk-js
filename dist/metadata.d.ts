export interface Metadata {
    name: string;
    displayName: string;
    about: string;
    picture?: string;
    banner?: string;
    nip05?: string;
    lud16?: string;
    bot?: true;
}
export interface MetadataConfigFields {
    name: string;
    displayName: string;
    about: string;
    picture?: string;
    banner?: string;
    nip05?: string;
    lud16?: string;
}
export declare class MetadataConfig {
    name: string;
    displayName: string;
    about: string;
    picture?: string | undefined;
    banner?: string | undefined;
    nip05?: string | undefined;
    lud16?: string | undefined;
    constructor(name: string, displayName: string, about: string, picture?: string | undefined, banner?: string | undefined, nip05?: string | undefined, lud16?: string | undefined);
    build(): Metadata;
}
export declare class MetadataConfigBuilder {
    private config;
    name(value: string): this;
    displayName(value: string): this;
    about(value: string): this;
    picture(value: string): this;
    banner(value: string): this;
    nip05(value: string): this;
    lud16(value: string): this;
    build(): Metadata;
}
export declare function createMetadata(name: string, displayName: string, about: string, picture?: string, banner?: string, nip05?: string, lud16?: string): Metadata;
