# CourierPlanner Solution Guide

This is the application-level reference for the CourierPlanner repository. It
maps the runtime, API, carrier integrations, persistence, SAP/EDI and document
workflows, background processing, configuration, and deployment entry points.
It is intended as a starting point for future maintenance; consult the
referenced source when implementing or changing behavior.

## 1. What this service does

CourierPlanner is a Node.js and Express shipping integration service. Its
primary API accepts shipping-related requests, routes supported operations to
carrier integrations, and returns normalized responses. Supporting code
provides rating, tracking, address validation, shipment persistence, SAP-facing
modules, EDI generation, document handling, and scheduled/background jobs.

The main web application starts at `index.js`. The normal API processing path
is:

```text
HTTP request
  -> global origin/CORS and body parsing middleware
  -> mounted route
  -> controller
  -> carrier factory / carrier implementation or shared service
  -> optional database, document, or tracking work
  -> formatted HTTP response
```

Not every folder represents an endpoint mounted by the main Express app. In
particular, some SAP, EDI, and job modules have their own handlers or startup
logic; confirm their invocation/deployment path before assuming they are
reachable through `index.js`.

## 2. Quick navigation

| Area | Location | Role |
| --- | --- | --- |
| Web entry point and middleware | `index.js` | Loads configuration, sets middleware, mounts routes, starts Express |
| API definitions | `routes/` | Express route declarations and request-specific middleware |
| Business logic | `controllers/` | Validates and coordinates shipping operations |
| Carrier integrations | `carriers/` | Carrier-specific API, credential, label, rate, and tracking logic |
| Carrier selection | `factories/` | Discovers/chooses carrier implementations |
| Database access | `database/` | PostgreSQL connection and persistence/lookups |
| Shared integration helpers | `Reuse/`, `generic/`, `lib/`, `utils/` | Common API, token, transport, document, response and logging helpers |
| SAP-facing modules | `SAPSHIP/`, `SAPRATE/`, `SAPTRACK/`, `SAPINVOICE/` | SAP TMS shipping, rates, tracking, and invoice events |
| EDI | `edi/` | X12 message handling and generation |
| Shipping documents | `ShippingDocuments/` | Label/document helpers and transformations |
| Tracking and batch jobs | `jobs/`, `TRACKING/` | Scheduled or batch processing |
| Example requests | `requests/` | Request/response examples useful for development |
| API documentation | `swagger.js` and `/api-docs` | Swagger specification and UI |
| Runtime/deployment | `package.json`, `dockerfile`, `Procfile`, `manifest.yml` | Node scripts, container, process types, deployment metadata |

## 3. Runtime and HTTP application

### Starting the service

- Runtime: Node.js 20 (declared in `package.json`).
- Main entry point: `index.js`.
- Local command: `npm start` (runs `node index.js`).
- Port: `PORT` environment variable, falling back to `5001`.
- API description: Swagger UI is mounted at `/api-docs`.

### Middleware and request handling

`index.js` applies origin checks and CORS, then configures parsing for XML,
JSON, and URL-encoded bodies. XML input is supported for SAP-facing
integrations. JSON and URL-encoded bodies have a configured 50 MB limit; XML
parsing is limited to 1 MB. The application has a final Express error handler
that logs errors and returns a JSON error response.

The origin check allows the Pack Planner origin and localhost development
origins. Requests without an `Origin` header are not rejected by that
origin-check middleware; CORS behavior is separately configured. Review both
controls before changing cross-origin behavior.

### Main mounted API paths

These are the API mount points in `index.js`; consult Swagger and the route
files for the specific HTTP methods, parameter shapes, and response schemas.

| Mount path | Route source / domain |
| --- | --- |
| `/api/getshipdata` | `routes/getshipdata.route.js` |
| `/api/addressvalidation` | `routes/addressvalidate.route.js` |
| `/api/return` | `routes/return.route.js` |
| `/api/ship` | `routes/ship.route.js` |
| `/api/ipdMaster` | FedEx IPD master carrier route |
| `/api/ipdChild` | FedEx IPD child carrier route |
| `/api/ipdClose` | FedEx IPD close carrier route |
| `/api/void` | `routes/void.route.js` |
| `/api/track` | `routes/track.route.js` |
| `/api/rateall` | `routes/rateAll.route.js` |

The route mount is a prefix, not a complete endpoint specification. Read each
route module or the live Swagger document to find its concrete methods and
paths.

## 4. Request and carrier flow

The common structure separates routing, coordination, and carrier-specific
implementation:

1. A route declares the HTTP method, path, and any request middleware such as
   upload handling.
2. A controller validates and interprets the request, then calls an
   appropriate factory or shared service.
3. A carrier implementation performs the provider-specific operation.
4. The controller may persist successful results, generate documents, or
   invoke related services.
5. The route/controller returns the operation response to the caller.

For example, the shipment route accepts a shipment request and can accept an
in-memory `invoiceFile` upload. The shipment controller coordinates
validation, carrier dispatch, requested document generation, persistence of
successful shipment results, and the response. Tracking uses a carrier choice
and calls the carrier's tracking operation.

The carrier modules do not necessarily implement identical operations. Check
the selected carrier's exports and the relevant factory before adding a new
operation or assuming a given carrier supports it.

### Carrier coverage

The `carriers/` tree includes carrier-specific modules for ABF, Averitt, Blue
Dart, Canada Post, DHL/DHL GF, Estes, FedEx/FedEx Freight, ODFL, Pitt Ohio,
Purolator, RL, Saia, SEFL, UPS, USPS, XPO, and Generic integrations. The
shipping factory discovers carrier directories and selects implementations;
rating uses a separate rate factory. Exact support, configuration, and
behavior vary by carrier and operation.

## 5. Data and shared services

### PostgreSQL

`database/db.js` configures PostgreSQL access through `pg-promise` using
`DATABASE_URL`. `database/dbsaveandupdate.js` contains application-level
lookups and persistence functions, including carrier/service/credential and
shipper-location lookups, plus shipment, tracking, rates, transactions, and
invoice-related operations.

Before changing persistence, trace the caller and inspect the SQL and expected
database schema. This repository guide does not prescribe database table
definitions or claim that a local database is available.

### Shared integration helpers

`Reuse/`, `generic/`, `lib/`, and `utils/` hold shared implementation pieces.
They include API/token and transport helpers, FTP/SFTP support, response
formatting, logging/error helpers, and the client for the external document
engine. Reuse these established helpers when extending carrier behavior.

## 6. SAP, EDI, documents, and tracking

- **SAP modules:** `SAPSHIP/`, `SAPRATE/`, `SAPTRACK/`, and `SAPINVOICE/`
  contain SAP-facing shipment, rate, tracking, and invoice-event code.
- **EDI:** `edi/` contains X12 handling; `edi/edi.js` includes an Express
  handler that builds an 856 shipment-notice message.
- **Documents:** `ShippingDocuments/` contains shipping document helpers.
  Shipment processing can also call an external document engine configured
  through `DOC_ENGINE_URL`.
- **Tracking:** Tracking route/controller code is under `routes/` and
  `controllers/`; additional tracking-related code is under `TRACKING/` and
  `jobs/`.

Some of these modules define their own Express routers or handlers but are not
mounted by the main `index.js` app. Their exact active invocation path may be
provided by a separate process or external integration; verify deployment
configuration before treating them as main-app endpoints.

## 7. Background processing

The `jobs/` directory contains scheduled or batch processing code, including
tracking and mail-related jobs. `Procfile` declares web and worker process
types, but `jobRunner.js` currently only logs startup; its job imports are
commented out. Confirm how jobs are actually started in the target environment
before relying on the worker declaration to run a particular schedule.

## 8. Configuration and secrets

`.env.example` lists example configuration keys and placeholders. Use it as a
starting inventory, then trace each setting to its consumer and provide
production values through the hosting environment. At minimum, the documented
integrations use settings such as `DATABASE_URL` and, where applicable,
`DOC_ENGINE_URL`; carrier and SAP integrations may require additional
credentials and endpoint settings.

Never copy real credentials from a local `.env` into source control,
documentation, logs, or client-side code. Keep production secrets in the
deployment platform's secret/environment-variable configuration. The
repository's `.env.example` contains placeholders, not production values.

### Swagger Google sign-in

Google OAuth support in `middleware/swaggerGoogleAuth.js` is specifically for
the Swagger UI, not the shipping APIs. The `requireAuth` middleware is
currently commented out in `index.js`, so `/api-docs/` is publicly accessible.
The OAuth routes and session setup remain mounted. When enabling the gate,
configure the variables listed in `.env.example` (Google client ID/secret,
callback URL, allowlisted Gmail addresses, and session secret), enable
`swaggerGoogleAuth.requireAuth`, then verify both allowed and denied accounts.
See `middleware/swaggerGoogleAuth.js` and the Swagger section of `index.js` for
the implementation.

## 9. Deployment and operations

- **Docker:** `dockerfile` uses Node 20 Alpine, installs Chromium for
  Puppeteer, and starts `index.js`.
- **Cloud Foundry-style deployment:** `manifest.yml` contains app/deployment
  metadata.
- **Process declarations:** `Procfile` declares web and worker process types.
- **Port:** The web process reads `PORT`, defaulting to 5001.
- **External dependencies:** Database, carrier services, and optional
  document-engine integrations require their corresponding deployed
  credentials and network access.

For a release, verify the configured process actually invokes the desired web
and worker entry points. A declaration in a deployment file does not by itself
prove that a particular job or module is running.

## 10. Development and verification

1. Install dependencies with `npm install` when setting up a development
   checkout.
2. Configure required local environment values without committing secrets.
3. Start the web service with `npm start`.
4. Open `/api-docs` to inspect the API contract.
5. Use examples under `requests/` where applicable and inspect the matching
   route/controller/carrier implementation.
6. Exercise carrier operations only with suitable test credentials and
   non-production endpoints when available.

The current `package.json` does not define a test script, and no automated
project test suite was identified during this documentation pass. Run the
appropriate checks for any code change and consider adding focused tests for
new or changed behavior.

## 11. Maintenance checklist

- Update the relevant route/controller/factory/carrier module together.
- Confirm carrier operation support instead of assuming uniform capabilities.
- Preserve request and response shapes described by Swagger and existing
  callers.
- Verify database effects and failure handling for persistence changes.
- Check XML parsing and request-size assumptions for SAP/EDI changes.
- Confirm any new router is actually mounted or invoked in its deployed
  process.
- Keep credentials out of source control and logs.
- Update this guide when architecture, process entry points, or deployment
  behavior changes.
