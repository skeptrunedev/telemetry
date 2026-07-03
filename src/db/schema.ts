import { sql } from "drizzle-orm";
import { sqliteTable, integer, real, text, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";

const nowMs = sql`(unixepoch() * 1000)`;

// Every row is owned by the Cloudflare Access-verified email (user_email).
// All queries are scoped by it, so users only ever see their own data.

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     sessionCookie:
 *       type: apiKey
 *       in: cookie
 *       name: __Secure-better-auth.session_token
 *       description: >-
 *         Better Auth session. Signing in (Google or email magic link) sets an
 *         HttpOnly session cookie that scopes every request to that account. The
 *         web app and CLI use this; agents use the OAuth 2.1 flow of the MCP server.
 *     bearerApiKey:
 *       type: http
 *       scheme: bearer
 *       description: >-
 *         Personal API key sent as `Authorization: Bearer skcal_…`. Create and
 *         scope keys in the app under your profile → API keys. Keys default to
 *         full access; a scoped key is limited to its granted `resource:action`
 *         permissions and cannot manage other keys.
 *     ingestToken:
 *       type: http
 *       scheme: bearer
 *       description: "Shared secret carried as `Authorization: Bearer <token>`, used only by the scale-ingest route."
 *   responses:
 *     BadRequest:
 *       description: The request body or parameters failed validation.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *     Unauthorized:
 *       description: Missing or incorrect ingest bearer token.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *     Forbidden:
 *       description: The requested resource belongs to another user.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *     NotFound:
 *       description: No matching resource owned by the caller.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *     BadGateway:
 *       description: The upstream model call failed.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *     ServiceUnavailable:
 *       description: A required secret (model key or ingest token) is not configured.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *   schemas:
 *     Error:
 *       type: object
 *       description: Standard error envelope returned by every non-2xx response.
 *       additionalProperties: false
 *       required: [error]
 *       properties:
 *         error:
 *           type: string
 *           description: Human-readable failure reason.
 *           example: weightKg must be 9-320 kg
 *         detail:
 *           type: string
 *           description: Optional extra context, present on upstream failures.
 *           example: upstream model returned 500
 *     Ok:
 *       type: object
 *       description: Minimal success acknowledgement for write operations.
 *       additionalProperties: false
 *       required: [ok]
 *       properties:
 *         ok:
 *           type: boolean
 *           const: true
 *           description: Always true.
 *           example: true
 *     Health:
 *       type: object
 *       description: Liveness probe payload.
 *       additionalProperties: false
 *       required: [ok, service, ts]
 *       properties:
 *         ok:
 *           type: boolean
 *           description: Always true when the Worker is responding.
 *           example: true
 *         service:
 *           type: string
 *           description: Service identifier.
 *           example: skcal
 *         ts:
 *           type: string
 *           format: date-time
 *           description: Server time when the probe was answered.
 *           example: "2026-06-29T12:00:00.000Z"
 *     WhoAmI:
 *       type: object
 *       description: The signed-in identity resolved for this request.
 *       additionalProperties: false
 *       required: [email]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: Verified account email, or `dev@local` in local development.
 *           example: nick@mintlify.com
 *     WeightReading:
 *       type: object
 *       description: A single body-weight reading.
 *       additionalProperties: false
 *       required: [id, ts, weightKg, bodyFatPct, note, source]
 *       properties:
 *         id:
 *           type: integer
 *           description: Auto-increment weight-reading identifier.
 *           example: 4821
 *         ts:
 *           type: integer
 *           format: int64
 *           description: Weigh-in time as a Unix epoch in milliseconds.
 *           example: 1782000000000
 *         weightKg:
 *           type: number
 *           description: Recorded body weight in kilograms.
 *           example: 72.6
 *         bodyFatPct:
 *           type: [number, "null"]
 *           description: Body-fat percentage, if recorded (noisy on consumer scales).
 *           example: 17.4
 *         note:
 *           type: [string, "null"]
 *           description: Free-text note attached to the reading.
 *           example: morning, fasted
 *         source:
 *           type: string
 *           description: Where the reading came from, e.g. `manual` or `scale`.
 *           example: manual
 *     NewWeight:
 *       type: object
 *       description: Body for logging a manual weigh-in.
 *       additionalProperties: false
 *       required: [weightKg]
 *       properties:
 *         weightKg:
 *           type: number
 *           minimum: 9
 *           maximum: 320
 *           description: Body weight to log, in kilograms.
 *           example: 72.6
 *         bodyFatPct:
 *           type: [number, "null"]
 *           minimum: 1
 *           maximum: 80
 *           description: Optional body-fat percentage for the weigh-in.
 *           example: 17.4
 *         note:
 *           type: string
 *           maxLength: 500
 *           description: Optional note (truncated to 500 characters).
 *           example: morning, fasted
 *     WeightNote:
 *       type: object
 *       description: Body for editing the note on an existing weigh-in.
 *       additionalProperties: false
 *       properties:
 *         note:
 *           type: [string, "null"]
 *           maxLength: 500
 *           description: New note text, or null to clear it.
 *           example: re-weighed after workout
 *     Measurement:
 *       type: object
 *       description: A body-part circumference measurement.
 *       additionalProperties: false
 *       required: [id, ts, site, valueCm, source]
 *       properties:
 *         id:
 *           type: integer
 *           description: Auto-increment measurement identifier.
 *           example: 318
 *         ts:
 *           type: integer
 *           format: int64
 *           description: Measurement time as a Unix epoch in milliseconds.
 *           example: 1782000000000
 *         site:
 *           type: string
 *           description: Body site, e.g. `waist`, `shoulders`, `arm_r`.
 *           example: waist
 *         valueCm:
 *           type: number
 *           description: Measured circumference in centimetres.
 *           example: 81.5
 *         source:
 *           type: string
 *           description: Where the measurement came from.
 *           example: manual
 *     NewMeasurement:
 *       type: object
 *       description: Body for recording a measurement.
 *       additionalProperties: false
 *       required: [site, valueCm]
 *       properties:
 *         site:
 *           type: string
 *           description: Body site identifier for the new measurement.
 *           example: waist
 *         valueCm:
 *           type: number
 *           minimum: 1
 *           maximum: 300
 *           description: Circumference to record, in centimetres.
 *           example: 81.5
 *     NutritionDay:
 *       type: object
 *       description: Rolled-up calorie and protein totals for one calendar day.
 *       additionalProperties: false
 *       required: [userEmail, date, kcal, proteinG, hitProtein, adherence]
 *       properties:
 *         userEmail:
 *           type: string
 *           format: email
 *           description: Owning account email.
 *           example: nick@mintlify.com
 *         date:
 *           type: string
 *           format: date
 *           description: Calendar day these totals cover (YYYY-MM-DD).
 *           example: "2026-06-29"
 *         kcal:
 *           type: [integer, "null"]
 *           description: Total calories logged that day.
 *           example: 2150
 *         proteinG:
 *           type: [integer, "null"]
 *           description: Total protein in grams logged that day.
 *           example: 168
 *         hitProtein:
 *           type: [boolean, "null"]
 *           description: Whether the day's protein target was met.
 *           example: true
 *         adherence:
 *           type: [string, "null"]
 *           enum: [under, on, over, null]
 *           description: Calorie adherence bucket for the day.
 *           example: on
 *     NutritionDayInput:
 *       type: object
 *       description: Body for upserting a day's totals directly.
 *       additionalProperties: false
 *       required: [date]
 *       properties:
 *         date:
 *           type: string
 *           format: date
 *           description: Calendar day to upsert (YYYY-MM-DD).
 *           example: "2026-06-29"
 *         kcal:
 *           type: [integer, "null"]
 *           minimum: 0
 *           maximum: 20000
 *           description: Total calories to set for the day.
 *           example: 2150
 *         proteinG:
 *           type: [integer, "null"]
 *           minimum: 0
 *           maximum: 1000
 *           description: Total protein in grams to set for the day.
 *           example: 168
 *         hitProtein:
 *           type: [boolean, "null"]
 *           description: Whether to mark the protein target as met.
 *           example: true
 *         adherence:
 *           type: [string, "null"]
 *           enum: [under, on, over, null]
 *           description: Calorie adherence bucket to set.
 *           example: on
 *     Targets:
 *       type: object
 *       description: A user's goals. Created with defaults on first read.
 *       additionalProperties: false
 *       required: [id, goalWeightKg, startWeightKg, targetDate, startDate, dailyKcalTarget, proteinTargetG]
 *       properties:
 *         id:
 *           type: integer
 *           description: Auto-increment targets-row identifier.
 *           example: 1
 *         goalWeightKg:
 *           type: [number, "null"]
 *           description: Target body weight in kilograms.
 *           example: 70
 *         startWeightKg:
 *           type: [number, "null"]
 *           description: Starting body weight in kilograms.
 *           example: 78.4
 *         targetDate:
 *           type: [integer, "null"]
 *           format: int64
 *           description: Goal date as a Unix epoch in milliseconds.
 *           example: 1790000000000
 *         startDate:
 *           type: [integer, "null"]
 *           format: int64
 *           description: Plan start date as a Unix epoch in milliseconds.
 *           example: 1782000000000
 *         dailyKcalTarget:
 *           type: [integer, "null"]
 *           description: Daily calorie target.
 *           example: 2100
 *         proteinTargetG:
 *           type: [integer, "null"]
 *           description: Daily protein target in grams.
 *           example: 170
 *     TargetsInput:
 *       type: object
 *       description: Partial update to a user's targets; omitted fields are left unchanged.
 *       additionalProperties: false
 *       properties:
 *         goalWeightKg:
 *           type: number
 *           description: New target body weight in kilograms.
 *           example: 70
 *         startWeightKg:
 *           type: number
 *           description: New starting body weight in kilograms.
 *           example: 78.4
 *         dailyKcalTarget:
 *           type: integer
 *           description: New daily calorie target.
 *           example: 2100
 *         proteinTargetG:
 *           type: integer
 *           description: New daily protein target in grams.
 *           example: 170
 *         targetDate:
 *           type: integer
 *           format: int64
 *           description: New goal date as a Unix epoch in milliseconds.
 *           example: 1790000000000
 *     TrendPoint:
 *       type: object
 *       description: One point on the weight trend line.
 *       additionalProperties: false
 *       required: [ts, kg]
 *       properties:
 *         ts:
 *           type: integer
 *           format: int64
 *           description: Trend-point time as a Unix epoch in milliseconds.
 *           example: 1782000000000
 *         kg:
 *           type: number
 *           description: Trend-point body weight in kilograms.
 *           example: 72.6
 *     WeightSummary:
 *       type: object
 *       description: Latest-weight summary block of the dashboard.
 *       additionalProperties: false
 *       required: [latestKg, weeklyAvgKg, bodyFatPct, note, trend]
 *       properties:
 *         latestKg:
 *           type: [number, "null"]
 *           description: Most recent weight in kilograms.
 *           example: 72.6
 *         weeklyAvgKg:
 *           type: [number, "null"]
 *           description: Mean weight over the last seven days.
 *           example: 72.9
 *         bodyFatPct:
 *           type: [number, "null"]
 *           description: Body-fat percentage from the latest reading.
 *           example: 17.4
 *         note:
 *           type: [string, "null"]
 *           description: Note on the latest reading.
 *           example: morning, fasted
 *         trend:
 *           type: array
 *           description: Chronological weight trend (oldest first).
 *           example: [{ ts: 1781000000000, kg: 73.1 }, { ts: 1782000000000, kg: 72.6 }]
 *           items:
 *             $ref: '#/components/schemas/TrendPoint'
 *     MeasurementLatest:
 *       type: object
 *       description: Most recent value for one measurement site.
 *       additionalProperties: false
 *       required: [site, valueCm, ts]
 *       properties:
 *         site:
 *           type: string
 *           description: Body site of this latest measurement.
 *           example: waist
 *         valueCm:
 *           type: number
 *           description: Latest circumference in centimetres.
 *           example: 81.5
 *         ts:
 *           type: integer
 *           format: int64
 *           description: Time of the latest measurement as a Unix epoch in milliseconds.
 *           example: 1782000000000
 *     DashboardData:
 *       type: object
 *       description: Everything the home screen needs in a single response.
 *       additionalProperties: false
 *       required: [weight, targets, measurementsLatest, shoulderToWaist, nutritionToday]
 *       properties:
 *         weight:
 *           type: object
 *           $ref: '#/components/schemas/WeightSummary'
 *           description: Latest-weight summary for the dashboard card.
 *           example: { latestKg: 72.6, weeklyAvgKg: 72.9, bodyFatPct: 17.4, note: "morning, fasted", trend: [{ ts: 1782000000000, kg: 72.6 }] }
 *         targets:
 *           type: object
 *           $ref: '#/components/schemas/Targets'
 *           description: The user's current goals shown on the dashboard.
 *           example: { id: 1, goalWeightKg: 70, startWeightKg: 78.4, targetDate: 1790000000000, startDate: 1782000000000, dailyKcalTarget: 2100, proteinTargetG: 170 }
 *         measurementsLatest:
 *           type: array
 *           description: Latest value per measured site.
 *           example: [{ site: waist, valueCm: 81.5, ts: 1782000000000 }, { site: shoulders, valueCm: 122, ts: 1782000000000 }]
 *           items:
 *             $ref: '#/components/schemas/MeasurementLatest'
 *         shoulderToWaist:
 *           type: [number, "null"]
 *           description: Shoulder-to-waist ratio (V-taper metric).
 *           example: 1.497
 *         nutritionToday:
 *           oneOf:
 *             - $ref: '#/components/schemas/NutritionDay'
 *             - type: "null"
 *           description: Today's nutrition totals, or null if nothing is logged.
 *           example: { userEmail: nick@mintlify.com, date: "2026-06-29", kcal: 2150, proteinG: 168, hitProtein: true, adherence: on }
 *     IngestWeight:
 *       type: object
 *       description: Body for a machine-submitted scale reading.
 *       additionalProperties: false
 *       required: [weightKg]
 *       properties:
 *         weightKg:
 *           type: number
 *           minimum: 9
 *           maximum: 320
 *           description: Scale-reported body weight in kilograms.
 *           example: 72.6
 *         bodyFatPct:
 *           type: [number, "null"]
 *           description: Optional scale-reported body-fat percentage.
 *           example: 17.4
 *         userEmail:
 *           type: string
 *           format: email
 *           description: Owner to attribute the reading to; falls back to the configured ingest user.
 *           example: nick@mintlify.com
 *         raw:
 *           type: object
 *           additionalProperties: true
 *           description: Opaque raw payload from the scale, stored for debugging.
 *           example: { device: "withings-body+", battery: 82 }
 *     AnalyzedItem:
 *       type: object
 *       description: One food item estimated by the model.
 *       additionalProperties: false
 *       required: [name, kcal, proteinG]
 *       properties:
 *         name:
 *           type: string
 *           description: Estimated food item name.
 *           example: grilled chicken breast
 *         kcal:
 *           type: integer
 *           description: Estimated calories for the portion.
 *           example: 284
 *         proteinG:
 *           type: number
 *           description: Estimated protein in grams.
 *           example: 53.4
 *     MealAnalysis:
 *       type: object
 *       description: Result of logging a meal from photos or a text description.
 *       additionalProperties: false
 *       required: [ok, mealId, items, totalKcal, totalProteinG, note, photoKeys]
 *       properties:
 *         ok:
 *           type: boolean
 *           const: true
 *           description: Always true once analysis succeeds.
 *           example: true
 *         mealId:
 *           type: string
 *           format: uuid
 *           description: Identifier of the created meal.
 *           example: 3f8b1c2a-5d6e-4f70-8a1b-2c3d4e5f6071
 *         items:
 *           type: array
 *           description: Estimated food items.
 *           example: [{ name: grilled chicken breast, kcal: 284, proteinG: 53.4 }, { name: toum, kcal: 90, proteinG: 0.4 }]
 *           items:
 *             $ref: '#/components/schemas/AnalyzedItem'
 *         totalKcal:
 *           type: integer
 *           description: Summed calories across items.
 *           example: 374
 *         totalProteinG:
 *           type: integer
 *           description: Summed protein in grams across items.
 *           example: 54
 *         note:
 *           type: string
 *           description: The model's one-line assumptions note.
 *           example: assumed a single chicken breast and one tablespoon of toum
 *         photoKeys:
 *           type: array
 *           description: R2 object keys of stored photos (empty for text descriptions).
 *           example: ["nick@mintlify.com/2026-06-29/3f8b1c2a-5d6e-4f70-8a1b-2c3d4e5f6071"]
 *           items:
 *             type: string
 *             example: nick@mintlify.com/2026-06-29/3f8b1c2a
 *     WorkoutExercise:
 *       type: object
 *       description: One exercise inside a strength-style workout; null fields were not stated.
 *       additionalProperties: false
 *       required: [exercise, sets, reps, weightLb, durationS, distanceM, notes]
 *       properties:
 *         exercise:
 *           type: string
 *           description: Exercise name as the user gave it.
 *           example: bench press
 *         sets:
 *           type: [integer, 'null']
 *           description: Number of sets, when stated.
 *           example: 3
 *         reps:
 *           type: [integer, 'null']
 *           description: Reps per set, when stated.
 *           example: 8
 *         weightLb:
 *           type: [number, 'null']
 *           description: Working weight in pounds, when stated.
 *           example: 135
 *         durationS:
 *           type: [integer, 'null']
 *           description: Duration in seconds for timed pieces, when stated.
 *           example: null
 *         distanceM:
 *           type: [number, 'null']
 *           description: Distance in meters for distance pieces, when stated.
 *           example: null
 *         notes:
 *           type: [string, 'null']
 *           description: Anything else the user said about the exercise.
 *           example: paused reps
 *     Workout:
 *       type: object
 *       description: A logged workout, normalized to the standard fields of Apple Health, Garmin, and Strava; metric fields are null when the user didn't state them.
 *       additionalProperties: false
 *       required: [id, source, activityType, summary, description, startedAt, durationS, movingDurationS, distanceM, elevationGainM, energyKcal, avgHr, maxHr, avgPowerW, avgCadence, exercises, createdAt]
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Workout identifier.
 *           example: 9c2d1e4f-7a8b-4c5d-9e0f-1a2b3c4d5e6f
 *         source:
 *           type: string
 *           enum: [manual, apple_health, garmin, strava]
 *           description: Where the workout came from; manual for described/photographed logs.
 *           example: manual
 *         activityType:
 *           type: string
 *           description: Normalized activity type (run, ride, swim, walk, hike, strength_training, yoga, rowing, elliptical, crossfit, other).
 *           example: run
 *         summary:
 *           type: string
 *           description: Short AI-generated title.
 *           example: 5k run + pullups
 *         description:
 *           type: string
 *           description: The user's original words (or the summary for photo-only logs).
 *           example: ran 5k easy, then 3x10 pullups
 *         startedAt:
 *           type: integer
 *           description: Start time as Unix milliseconds.
 *           example: 1783100000000
 *         durationS:
 *           type: [integer, 'null']
 *           description: Elapsed duration in seconds.
 *           example: 1680
 *         movingDurationS:
 *           type: [integer, 'null']
 *           description: Moving time in seconds, when distinct from elapsed.
 *           example: null
 *         distanceM:
 *           type: [number, 'null']
 *           description: Distance in meters.
 *           example: 5000
 *         elevationGainM:
 *           type: [number, 'null']
 *           description: Elevation gain in meters.
 *           example: null
 *         energyKcal:
 *           type: [number, 'null']
 *           description: Active energy in kilocalories.
 *           example: 320
 *         avgHr:
 *           type: [integer, 'null']
 *           description: Average heart rate in bpm.
 *           example: 148
 *         maxHr:
 *           type: [integer, 'null']
 *           description: Max heart rate in bpm.
 *           example: null
 *         avgPowerW:
 *           type: [number, 'null']
 *           description: Average power in watts.
 *           example: null
 *         avgCadence:
 *           type: [number, 'null']
 *           description: Average cadence (spm or rpm as reported).
 *           example: null
 *         exercises:
 *           type: array
 *           description: Strength breakdown; empty for pure cardio.
 *           example: [{ exercise: pullups, sets: 3, reps: 10, weightLb: null, durationS: null, distanceM: null, notes: null }]
 *           items:
 *             $ref: '#/components/schemas/WorkoutExercise'
 *         createdAt:
 *           type: integer
 *           description: Row creation time as Unix milliseconds.
 *           example: 1783100001000
 *     DescribeWorkout:
 *       type: object
 *       description: Body for logging a workout from a freeform text description.
 *       additionalProperties: false
 *       required: [text]
 *       properties:
 *         text:
 *           type: string
 *           maxLength: 4000
 *           description: The workout in the user's own words.
 *           example: ran 5k easy in 28 minutes, then 3x10 pullups
 *         date:
 *           type: string
 *           format: date
 *           description: Local day to log against (YYYY-MM-DD); defaults to now.
 *           example: 2026-07-02
 *         tz:
 *           type: integer
 *           description: Timezone offset in minutes, as from getTimezoneOffset.
 *           example: 420
 *     AnyAnalysis:
 *       type: object
 *       description: Result of classify-and-log. `kind` says what the photos showed; food results carry the MealAnalysis fields, workout results carry `workout`, and `other` logs nothing.
 *       required: [kind]
 *       properties:
 *         kind:
 *           type: string
 *           enum: [food, workout, weight, measurement, other]
 *           description: What the photos were classified as.
 *           example: workout
 *         ok:
 *           type: boolean
 *           description: True when something was logged.
 *           example: true
 *         mealId:
 *           type: string
 *           format: uuid
 *           description: Created meal id (food only).
 *           example: 3f8b1c2a-5d6e-4f70-8a1b-2c3d4e5f6071
 *         items:
 *           type: array
 *           description: Estimated food items (food only).
 *           example: [{ name: grilled chicken breast, kcal: 284, proteinG: 53.4 }]
 *           items:
 *             $ref: '#/components/schemas/AnalyzedItem'
 *         totalKcal:
 *           type: integer
 *           description: Summed calories (food only).
 *           example: 374
 *         totalProteinG:
 *           type: integer
 *           description: Summed protein grams (food only).
 *           example: 54
 *         note:
 *           type: string
 *           description: Model assumptions note (food only).
 *           example: assumed a single chicken breast
 *         photoKeys:
 *           type: array
 *           description: Stored photo keys (food only).
 *           example: ["nick@mintlify.com/2026-06-29/3f8b1c2a"]
 *           items:
 *             type: string
 *             example: nick@mintlify.com/2026-06-29/3f8b1c2a
 *         workout:
 *           $ref: '#/components/schemas/Workout'
 *         pounds:
 *           type: number
 *           description: Logged body weight in pounds (weight only).
 *           example: 158.2
 *         weightKg:
 *           type: number
 *           description: Logged body weight in kilograms (weight only).
 *           example: 71.8
 *         bodyFatPct:
 *           type: [number, 'null']
 *           description: Body-fat percentage when the scale showed one (weight only).
 *           example: 17.2
 *         site:
 *           type: string
 *           description: Body site the measurement was logged against (measurement only).
 *           example: waist
 *         inches:
 *           type: number
 *           description: Measured value in inches (measurement only).
 *           example: 31.8
 *         needSite:
 *           type: boolean
 *           description: True when a measurement was read but the body site could not be identified — nothing was logged; resubmit with a caption naming the site.
 *           example: false
 *     DescribeMeal:
 *       type: object
 *       description: Body for logging a meal from a freeform text description.
 *       additionalProperties: false
 *       required: [text]
 *       properties:
 *         text:
 *           type: string
 *           maxLength: 2000
 *           description: What you ate, in your own words. State anything you skipped so it is excluded.
 *           example: two scrambled eggs, a slice of sourdough, and black coffee
 *     LoggedItem:
 *       type: object
 *       description: A persisted food item within a meal.
 *       additionalProperties: false
 *       required: [id, name, kcal, proteinG]
 *       properties:
 *         id:
 *           type: integer
 *           description: Auto-increment food-item identifier.
 *           example: 9012
 *         name:
 *           type: string
 *           description: Persisted food item name.
 *           example: grilled chicken breast
 *         kcal:
 *           type: integer
 *           description: Stored calories for the portion.
 *           example: 284
 *         proteinG:
 *           type: number
 *           description: Stored protein in grams.
 *           example: 53.4
 *     Meal:
 *       type: object
 *       description: A logged meal with its food items.
 *       additionalProperties: false
 *       required: [id, note, createdAt, photoKeys, items]
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Meal identifier.
 *           example: 3f8b1c2a-5d6e-4f70-8a1b-2c3d4e5f6071
 *         note:
 *           type: [string, "null"]
 *           description: Meal note or the original text description.
 *           example: lunch at the office
 *         createdAt:
 *           type: integer
 *           format: int64
 *           description: Meal creation time as a Unix epoch in milliseconds.
 *           example: 1782000000000
 *         photoKeys:
 *           type: array
 *           description: R2 object keys of the meal's photos.
 *           example: ["nick@mintlify.com/2026-06-29/3f8b1c2a-5d6e-4f70-8a1b-2c3d4e5f6071"]
 *           items:
 *             type: string
 *             example: nick@mintlify.com/2026-06-29/3f8b1c2a-5d6e
 *         items:
 *           type: array
 *           description: Food items in the meal.
 *           example: [{ id: 9012, name: grilled chicken breast, kcal: 284, proteinG: 53.4 }]
 *           items:
 *             $ref: '#/components/schemas/LoggedItem'
 *     CoachMessage:
 *       type: object
 *       description: One turn in the coach conversation.
 *       additionalProperties: false
 *       required: [role, content]
 *       properties:
 *         role:
 *           type: string
 *           enum: [user, assistant]
 *           description: Who authored the turn — the user or the coach.
 *           example: user
 *         content:
 *           type: string
 *           maxLength: 2000
 *           description: The message text (truncated to 2000 characters).
 *           example: what do you think of me eating a meat pie for breakfast?
 *     CoachRequest:
 *       type: object
 *       description: Body for asking the coach; the client sends the full running history each turn.
 *       additionalProperties: false
 *       required: [messages]
 *       properties:
 *         messages:
 *           type: array
 *           minItems: 1
 *           maxItems: 20
 *           description: Conversation history, oldest message first (1–20 turns).
 *           example: [{ role: user, content: "what do you think of me eating a meat pie for breakfast? how's that gonna impact my plan?" }]
 *           items:
 *             $ref: '#/components/schemas/CoachMessage'
 *         date:
 *           type: string
 *           format: date
 *           description: Optional calendar day (YYYY-MM-DD) whose logged intake grounds the reply; the server's current UTC date is used when omitted.
 *           example: "2026-06-30"
 *     CoachReply:
 *       type: object
 *       description: The coach's plain-text reply, grounded in the caller's targets, intake, and weight trend.
 *       additionalProperties: false
 *       required: [reply]
 *       properties:
 *         reply:
 *           type: string
 *           description: The coach's answer — an estimate, a budget fit, a blunt verdict, and a better option if it's a poor fit.
 *           example: "A meat pie runs about 550 kcal and 15 g protein. That eats a big chunk of your 1850 kcal budget for little protein — skip it. Have three eggs and Greek yogurt instead to hit protein without blowing the day."
 */

export const weightReadings = sqliteTable("weight_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().default(""),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(nowMs),
  weightKg: real("weight_kg").notNull(),
  bodyFatPct: real("body_fat_pct"),
  note: text("note"),
  source: text("source", { enum: ["scale", "manual"] }).notNull().default("manual"),
  rawPayload: text("raw_payload"),
});

export const measurements = sqliteTable("measurements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().default(""),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(nowMs),
  site: text("site").notNull(), // shoulders|chest|arm_l|arm_r|waist|neck|thigh|custom
  valueCm: real("value_cm").notNull(),
  source: text("source", { enum: ["tape", "manual"] }).notNull().default("manual"),
});

export const photos = sqliteTable("photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().default(""),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(nowMs),
  r2Key: text("r2_key").notNull(),
  pose: text("pose", { enum: ["front", "side", "back"] }),
  notes: text("notes"),
});

// One targets row per user.
export const targets = sqliteTable("targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().unique(),
  goalWeightKg: real("goal_weight_kg"),
  targetDate: integer("target_date", { mode: "timestamp_ms" }),
  startWeightKg: real("start_weight_kg"),
  startDate: integer("start_date", { mode: "timestamp_ms" }),
  dailyKcalTarget: integer("daily_kcal_target").default(1850),
  proteinTargetG: integer("protein_target_g").default(160),
});

// Per-day nutrition, one row per (user, date).
export const nutritionDays = sqliteTable(
  "nutrition_days",
  {
    userEmail: text("user_email").notNull().default(""),
    date: text("date").notNull(), // YYYY-MM-DD
    kcal: integer("kcal"),
    proteinG: integer("protein_g"),
    hitProtein: integer("hit_protein", { mode: "boolean" }),
    adherence: text("adherence", { enum: ["under", "on", "over"] }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userEmail, t.date] }) }),
);

// A logged meal: one AI photo-analysis (or manual add). Photos live in R2.
export const meals = sqliteTable("meals", {
  id: text("id").primaryKey(), // uuid
  userEmail: text("user_email").notNull().default(""),
  date: text("date").notNull(), // YYYY-MM-DD
  note: text("note"),
  photoKeys: text("photo_keys"), // JSON array of R2 object keys
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

// Per-food line items; SUM per (user, date) rolls up into nutrition_days.
export const nutritionItems = sqliteTable("nutrition_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().default(""),
  mealId: text("meal_id"),
  date: text("date").notNull(),
  name: text("name").notNull(),
  kcal: integer("kcal").notNull(),
  proteinG: real("protein_g").notNull(),
  source: text("source", { enum: ["ai", "manual"] }).notNull().default("ai"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const ingestTokens = sqliteTable("ingest_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email"),
  tokenHash: text("token_hash").notNull(),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

// Saved AI-coach conversations (one row per thread) + their messages, so the
// user can browse and locally search past chats. Scoped by user_email.
export const coachConversations = sqliteTable(
  "coach_conversations",
  {
    id: text("id").primaryKey(), // uuid
    userEmail: text("user_email").notNull().default(""),
    title: text("title").notNull().default("New chat"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => ({ userIdx: index("coach_conversations_user_idx").on(t.userEmail) }),
);

export const coachMessages = sqliteTable(
  "coach_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: text("conversation_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => ({ convIdx: index("coach_messages_conversation_idx").on(t.conversationId) }),
);

// ---------------------------------------------------------------------------
// Better Auth core tables (self-hosted auth, replacing Cloudflare Access).
//
// Column names + types MUST match what Better Auth's Drizzle adapter expects.
// These were emitted verbatim by `@better-auth/cli generate` for the exact
// installed version (better-auth 1.6.23) with the Google social provider + the
// magic-link plugin, then hand-copied here (and mirrored into a D1 migration).
// Do not rename columns; the adapter maps its logical fields to these names.
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// ---------------------------------------------------------------------------
// OAuth / OIDC provider tables — required by Better Auth's `mcp` plugin so the
// MCP server can be installed into clients over OAuth 2.1 (reusing the existing
// Google + magic-link login). Column names mirror the snake_case convention of
// the other Better Auth tables; model/export names match Better Auth's models.
// ---------------------------------------------------------------------------
export const oauthApplication = sqliteTable("oauth_application", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret"),
  icon: text("icon"),
  name: text("name").notNull(),
  redirectUrls: text("redirect_urls").notNull(),
  metadata: text("metadata"),
  type: text("type").notNull(),
  disabled: integer("disabled", { mode: "boolean" }),
  userId: text("user_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const oauthAccessToken = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    clientId: text("client_id").notNull(),
    userId: text("user_id"),
    scopes: text("scopes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [index("oauth_access_token_access_token_idx").on(table.accessToken)],
);

export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    scopes: text("scopes").notNull(),
    consentGiven: integer("consent_given", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [index("oauth_consent_user_idx").on(table.userId)],
);

// Bearer API keys for programmatic access to the HTTP API. We store only a
// SHA-256 hash of the token (never the token itself) plus a display prefix and
// the granted scopes (JSON array; ["*"] = full access).
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(), // uuid
    userEmail: text("user_email").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    prefix: text("prefix").notNull(),
    scopes: text("scopes").notNull().default('["*"]'),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("api_keys_token_hash_idx").on(t.tokenHash), index("api_keys_user_idx").on(t.userEmail)],
);

// Stripe billing state, one row per user. Kept in sync by the Stripe webhook;
// `status` mirrors the subscription status (active/trialing/past_due/canceled…).
export const billing = sqliteTable(
  "billing",
  {
    userEmail: text("user_email").primaryKey(),
    stripeCustomerId: text("stripe_customer_id"),
    subscriptionId: text("subscription_id"),
    status: text("status"),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [index("billing_customer_idx").on(t.stripeCustomerId), index("billing_subscription_idx").on(t.subscriptionId)],
);

// Channels linked to an account for agent access: verified phone numbers today
// (iMessage/SMS), telegram later. A channel value maps to exactly one account.
export const linkedChannels = sqliteTable(
  "linked_channels",
  {
    id: text("id").primaryKey(), // uuid
    userEmail: text("user_email").notNull(),
    kind: text("kind", { enum: ["phone", "telegram"] }).notNull(),
    value: text("value").notNull(), // E.164 phone, or telegram user id
    verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("linked_channels_user_idx").on(t.userEmail),
    index("linked_channels_value_idx").on(t.kind, t.value),
  ],
);

// Durable agent memories: preferences/facts the user states in conversation
// ("I don't like yogurt", "vegetarian", "training for a marathon"). Injected
// into every agent surface's grounding prompt.
export const agentMemories = sqliteTable(
  "agent_memories",
  {
    id: text("id").primaryKey(), // uuid
    userEmail: text("user_email").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [index("agent_memories_user_idx").on(t.userEmail)],
);

// Workout log: today the user describes what happened in their own words and
// the AI parse best-effort fills the metric fields; the columns mirror the
// standard fields of Apple Health (HKWorkout), Garmin (FIT session), and
// Strava (activity) so future platform imports land in the same table.
// Storage units are metric: meters, seconds, kcal, bpm, watts (weights in the
// `details` strength breakdown are pounds). Scoped by user_email as usual.
export const workouts = sqliteTable(
  "workouts",
  {
    id: text("id").primaryKey(), // uuid
    userEmail: text("user_email").notNull(),
    source: text("source", { enum: ["manual", "apple_health", "garmin", "strava"] }).notNull().default("manual"),
    externalId: text("external_id"), // import dedupe key; null for manual rows
    activityType: text("activity_type"), // normalized snake_case: run|ride|swim|…|other
    summary: text("summary").notNull(), // short AI-normalized title
    description: text("description").notNull(), // raw text the user gave
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    durationS: integer("duration_s"), // elapsed
    movingDurationS: integer("moving_duration_s"),
    distanceM: real("distance_m"),
    elevationGainM: real("elevation_gain_m"),
    energyKcal: real("energy_kcal"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    avgPowerW: real("avg_power_w"),
    avgCadence: real("avg_cadence"),
    details: text("details"), // JSON: [{exercise, sets, reps, weight_lb, duration_s, distance_m, notes}]
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("workouts_user_idx").on(t.userEmail),
    index("workouts_user_started_idx").on(t.userEmail, t.startedAt),
    // SQLite unique indexes allow multiple NULLs, so manual rows don't collide.
    uniqueIndex("workouts_source_external_idx").on(t.source, t.externalId),
  ],
);

// "Text to get started" requests from the landing page: the iMessage agent
// polls pending rows and sends the first message (shared-pool lines can't
// receive from strangers, so we always initiate).
export const textMeRequests = sqliteTable(
  "text_me_requests",
  {
    id: text("id").primaryKey(),
    phone: text("phone").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [index("text_me_requests_status_idx").on(t.status), index("text_me_requests_phone_idx").on(t.phone)],
);
