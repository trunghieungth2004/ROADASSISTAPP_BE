import {usersSchemas} from "./users";
import {vehiclesSchemas} from "./vehicles";
import {chatSchemas} from "./chat";
import {flagsSchemas} from "./flags";
import {landmarksSchemas} from "./landmarks";
import {routesSchemas} from "./routes";
import {pushSchemas} from "./push";
import {providersSchemas} from "./providers";
import {placesSchemas} from "./places";
import {diagnosticsSchemas} from "./diagnostics";
import {dispatchSchemas} from "./dispatch";
import {ratingsSchemas} from "./ratings";
import {metaSchemas} from "./meta";
import {paymentsSchemas} from "./payments";
import {adminSchemas} from "./admin";
import {notificationsSchemas} from "./notifications";
import {disputesSchemas} from "./disputes";

export const schemas = {
  ...usersSchemas,
  ...vehiclesSchemas,
  ...chatSchemas,
  ...flagsSchemas,
  ...landmarksSchemas,
  ...routesSchemas,
  ...pushSchemas,
  ...providersSchemas,
  ...placesSchemas,
  ...diagnosticsSchemas,
  ...dispatchSchemas,
  ...ratingsSchemas,
  ...metaSchemas,
  ...paymentsSchemas,
  ...adminSchemas,
  ...notificationsSchemas,
  ...disputesSchemas,
};

export {locationBody, MAX_STOPS} from "./primitives";
export type Schemas = typeof schemas;
