import type { MlsAdapter } from './demo.js';
export type SidecarAdapterOptions = {
    binPath: string;
    stateDir: string;
};
export declare function createMlsSidecarAdapter(options: SidecarAdapterOptions): MlsAdapter;
