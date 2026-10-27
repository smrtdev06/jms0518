import { NextResponse } from "next/server";
import { HttpError } from "./auth";

type Handler<C> = (request: Request, context: C) => Promise<Response>;

/** Wraps a route handler so thrown HttpErrors become JSON error responses. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof HttpError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error(error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

export function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

export function str(value: unknown, max = 10_000): string {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
}
