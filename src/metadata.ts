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

export class MetadataConfig {
  constructor(
    public name: string,
    public displayName: string,
    public about: string,
    public picture?: string,
    public banner?: string,
    public nip05?: string,
    public lud16?: string,
  ) {}

  public build(): Metadata {
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
  private config: MetadataConfigFields = {
    name: '',
    displayName: '',
    about: '',
  };

  public name(value: string): this {
    this.config.name = value;
    return this;
  }

  public displayName(value: string): this {
    this.config.displayName = value;
    return this;
  }

  public about(value: string): this {
    this.config.about = value;
    return this;
  }

  public picture(value: string): this {
    this.config.picture = value;
    return this;
  }

  public banner(value: string): this {
    this.config.banner = value;
    return this;
  }

  public nip05(value: string): this {
    this.config.nip05 = value;
    return this;
  }

  public lud16(value: string): this {
    this.config.lud16 = value;
    return this;
  }

  public build(): Metadata {
    return new MetadataConfig(
      this.config.name,
      this.config.displayName,
      this.config.about,
      this.config.picture,
      this.config.banner,
      this.config.nip05,
      this.config.lud16,
    ).build();
  }
}

export function createMetadata(
  name: string,
  displayName: string,
  about: string,
  picture?: string,
  banner?: string,
  nip05?: string,
  lud16?: string,
): Metadata {
  return new MetadataConfig(name, displayName, about, picture, banner, nip05, lud16).build();
}
