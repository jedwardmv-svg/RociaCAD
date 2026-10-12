/// <reference types="vite/client" />
import type { RociaApi } from '../../preload';

declare global {
  interface Window {
    /** Solo existe dentro de la app de escritorio; en un navegador normal es undefined */
    rocia?: RociaApi;
  }
}

export {};
