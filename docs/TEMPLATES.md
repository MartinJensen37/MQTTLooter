# Message schemas

A message schema is a JSON Schema with a topic, QoS and retain setting. Its payload template is generated from the schema, so **Fill payload** builds a message that matches it. Two examples are included: **Sensor reading** (`sensors/{{sensorId}}/reading`) and **Device status** (`devices/{{deviceId}}/status`, retained, QoS 1). Unchanged copies of the three earlier examples are replaced by them; edited and custom entries are kept, and a deleted example is not added back.

In Publishing, turn on **Message schemas** and choose a schema. Selection fills an editable draft using its variable defaults. Edit the variable fields and choose **Fill payload** to rebuild the payload. Applying also refreshes generated values; typing in a field does not replace a draft you may be editing. **Publish** sends the displayed draft without regenerating it.

An empty topic is filled from the schema's topic. Further applications update that generated topic until you edit it, load a history entry, or select another topic through auto-load. An existing manually chosen topic is preserved. The schema's QoS, retain and MQTT 5 properties are applied with the payload; one without properties clears previous property settings. MQTT 5 properties still require an MQTT 5 connection.

Expansion errors leave the previous draft intact and disable Publish while that schema is selected. Correct the variables and fill again, or deselect the schema to work directly with the draft. The status below the payload shows **Matches schema** or what differs; it does not block publishing. It uses a standards-based validator for the dialect declared in `$schema` (draft-04, draft-06/07, 2019-09 or 2020-12; 2020-12 when none is declared), including `$ref`/`$defs`, combinators, `const`, `format` and `additionalProperties`. References resolve only within the schema; remote schemas are never fetched. Errors name the failing location as a JSON Pointer, and at most 20 are listed.

## JSON and raw text

Keep a JSON template valid JSON before expansion: put placeholders inside JSON strings. A placeholder occupying a whole JSON value preserves its type. For example, `"count": "{{count}}"` produces `"count": 3` when `count` is a number. This works in nested objects, arrays and root values. A placeholder embedded in a larger string stays text, so `"label": "Count: {{count}}"` produces `"label": "Count: 3"`.

Strings are escaped once, including quotes, backslashes and newlines. Inserted text containing `{{uuid}}` or another placeholder stays literal; it is not evaluated again. Unchanged JSON tokens retain their original spelling, whitespace and numeric precision. Generated numbers and JSON variable inputs use JavaScript numeric precision; integer variables require safe integers.

Raw text templates retain their whitespace and interpolate values as text. Non-string values are serialized as JSON. Templates with a schema must start with a valid JSON payload. No JavaScript expressions or arbitrary code are executed.

## Variables and built-ins

Declare variables using `text` (or `string`), `number`, `integer`, `boolean` or `json`. Use native JSON defaults; a `json` variable can contain an object, array, scalar or null. Its editor accepts JSON text. Variables without a type use ordinary text fields; declare a type when editing non-string values. Variable edits apply to the current draft and do not overwrite the saved template defaults.

| Placeholder | Value |
| --- | --- |
| `{{timestamp}}` | Unix time in milliseconds, sampled once per application. |
| `{{isoTimestamp}}` | The same time as an ISO 8601 UTC string. |
| `{{uuid}}` | A random UUID shared by all UUID occurrences in that application, including the topic. The next application generates a new UUID. |
| `{{randomInt(-10, 10)}}` | An integer including both bounds. |
| `{{randomFloat(-1, 1, 3)}}` | A number rounded to the specified 0-10 decimal places. |
| `{{randomChoice("online", "offline")}}` | One of the supplied values. Quoted strings may contain commas or escaped quotes; legacy single-quoted strings are also accepted. |

Random functions are sampled per occurrence. Declared variables take precedence over built-in names. Unknown names, invalid arguments and invalid typed values produce errors. Placeholder delimiters `{{` and `}}` are reserved in template expressions; literal inserted values can contain them.

## Import example

Save this as a JSON file and use the import button beside the schema menu. Exports use the same format:

```json
{
  "templates": [{
    "id": "typed-telemetry",
    "name": "Typed telemetry",
    "category": "Devices",
    "topic": "devices/{{deviceId}}/telemetry",
    "qos": 0,
    "retain": false,
    "variables": {
      "deviceId": { "type": "text", "default": "device-001" },
      "reading": { "type": "number", "default": 21.5 },
      "online": { "type": "boolean", "default": true },
      "metadata": { "type": "json", "default": { "site": "lab" } }
    },
    "payload": "{\"device\":\"{{deviceId}}\",\"sample\":{\"value\":\"{{reading}}\",\"online\":\"{{online}}\"},\"metadata\":\"{{metadata}}\",\"timestamp\":\"{{timestamp}}\",\"id\":\"{{uuid}}\"}"
  }]
}
```

Entries without a `schema` still work; they fill the payload but cannot check it. JSON numeric generators now produce numbers instead of numeric strings; use a text variable or surrounding text if a string value is required.

Expansion is bounded to 1,048,576 text code units, 128 declared variables and 2,000 placeholder occurrences. Each substituted JSON value is bounded to 10,000 nodes and depth 64. These are editor work limits, not broker payload guarantees. Simulator devices can use the same placeholder syntax for combined payloads; see the simulator guide.

## Importing a JSON Schema

The import button also accepts a standalone JSON Schema (a file with `$schema`, `$id`, `title`, or `type` and `properties`). It becomes a message schema marked **Imported**. Its payload follows the schema's structure, with placeholders that produce a fresh valid value on each **Fill payload**:

| Schema | Generated value |
| --- | --- |
| `number` / `integer` with bounds (inclusive or exclusive) | `randomFloat` / `randomInt` within them; 0-100 when unbounded |
| `enum` with several scalar values | `randomChoice` of the values |
| `boolean` | `randomChoice(true, false)` |
| `string` with `format: uuid` / `date-time` | `{{uuid}}` / `{{isoTimestamp}}` |
| `const`, `default`, `examples` | that value |
| other strings | `sample`, padded or cut to `minLength`/`maxLength`; email, URI and date formats get a valid example |

Objects include every listed and required property; arrays get `minItems` items (at least one, at most three). Local `$ref`s, `allOf`, and the first `oneOf`/`anyOf` branch are followed; recursive references stop with `null`, and remote references are not fetched. A `pattern` cannot be generated, so edit those values by hand; schema validation shows what still fails.
