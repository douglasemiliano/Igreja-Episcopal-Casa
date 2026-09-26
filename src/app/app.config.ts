import {
  ApplicationConfig,
  LOCALE_ID,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { PwaUpdateService } from './services/pwa-update.service';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideCharts(withDefaultRegisterables()),
    { provide: LOCALE_ID, useValue: 'pt-BR' },
    { provide: 'DEFAULT_TIMEZONE', useValue: 'America/Recife' },
    DatePipe,
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      /*
       * Registrar logo no boot. Com 'registerWhenStable:30000' o app podia
       * ficar até 30 segundos sem service worker, e sem service worker não há
       * como detectar versão nova nenhuma.
       */
      registrationStrategy: 'registerImmediately',
    }),
    /*
     * Vigia a versão nova desde o bootstrap, e não só dentro do navbar: a
     * tela de login também precisa avisar. `iniciar` é síncrono de propósito
     * para não atrasar a abertura do app.
     */
    provideAppInitializer(() => inject(PwaUpdateService).iniciar()),
  ],
};
