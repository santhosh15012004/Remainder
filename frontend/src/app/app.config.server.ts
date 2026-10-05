import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { APP_BASE_HREF } from '@angular/common';
import { appConfig } from './app.config';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    { provide: APP_BASE_HREF, useValue: '/' }
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
