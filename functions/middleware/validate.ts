import {NextFunction, Request, Response} from "express";
import Joi from "joi";
import {sendError} from "../utils/response";

interface SchemaMap {
  body?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
}

export {SchemaMap};

export const validate =
  (schema: SchemaMap) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const parts = (["body", "params", "query"] as const).filter(
        (p) => schema && schema[p],
      );
      for (const part of parts) {
        const schemaFor = schema[part]!;
        const {error, value} = schemaFor.validate(req[part] || {}, {
          abortEarly: false,
          stripUnknown: true,
        });
        if (error) {
          sendError(res, {
            statusCode: 400,
            message: "Validation failed",
            errors: error.details.map((d) => d.message),
          } as unknown as Error & { errors: unknown });
          return;
        }
        (req as unknown as Record<string, unknown>)[part] = value;
      }
      next();
    };
