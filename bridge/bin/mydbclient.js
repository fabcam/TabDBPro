#!/usr/bin/env node
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
await import(resolve(__dirname, '../src/server.js'));
