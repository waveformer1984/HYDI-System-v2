import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ts-esm-loader.mjs', pathToFileURL(import.meta.dirname + '/'));
