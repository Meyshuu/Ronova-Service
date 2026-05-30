import { createSnapHandler } from './handler.js';

export default async function handler(req, res) {
  return createSnapHandler(req, res);
}

