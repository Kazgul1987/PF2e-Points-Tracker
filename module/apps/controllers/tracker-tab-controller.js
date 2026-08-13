import { logger } from "../../utils/logger.js";

const HTML_ESCAPE_LOOKUP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  if (!value) return "";
  if (foundry?.utils?.escapeHTML) {
    try {
      return foundry.utils.escapeHTML(value);
    } catch (error) {
      logger.error(error);
    }
  }
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_LOOKUP[char] ?? char);
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

/** Delegate shared application state while keeping subsystem behavior encapsulated. */
export class TrackerTabController {
  constructor(app) {
    this.app = app;
    return new Proxy(this, {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(receiver) : value;
        }
        const value = app[property];
        return typeof value === "function" ? value.bind(app) : value;
      },
      set(target, property, value, receiver) {
        if (Reflect.has(target, property)) return Reflect.set(target, property, value, receiver);
        app[property] = value;
        return true;
      },
    });
  }
}
