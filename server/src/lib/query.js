import mongoose from 'mongoose';
import { HttpError } from './httpError.js';

// Query-string values arrive as strings, arrays or nested objects (`?status[$ne]=x`); only plain strings are accepted.
export function queryString(value, name) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `Invalid ${name}`);
  return value;
}

export function queryObjectId(value, name) {
  const str = queryString(value, name);
  if (str === undefined) return undefined;
  if (!mongoose.isValidObjectId(str)) throw new HttpError(400, `Invalid ${name}`);
  return str;
}

export function queryDate(value, name) {
  const str = queryString(value, name);
  if (str === undefined) return undefined;
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `Invalid ${name}`);
  return date;
}

export function queryLimit(value, { fallback, max }) {
  const n = Number(typeof value === 'string' ? value : NaN);
  return Math.min(n > 0 ? Math.floor(n) : fallback, max);
}
