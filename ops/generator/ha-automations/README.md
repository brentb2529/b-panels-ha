# B-Infohub immediate alerts (Home Assistant)

Deployed on the production instance via `POST /api/config/automation/config/<id>`.
These JSON files are the exported source of truth; edit and re-POST to change them.

## Why these are in Home Assistant and not in Grafana

They are the alerts that must not wait.

The ESPHome connection to the bridge is push, and since ha-energytrak 1.14.0 an
urgent reading -- any of the 34 alarm bits, plus utility_power_failure,
engine_state, engine_running, engine_starting, switch_status and
common_shutdown -- is published the moment it changes, coalesced over 350ms.
So these automations fire roughly a third of a second after the generator's own
controller knows.

Grafana cannot do that and is not asked to. Metrics are pushed on a 30 second
timer, Prometheus needs a sample or two to evaluate, and every rule carries a
`for:` on top. `../alerts/generator-local-alerts.yml` therefore keeps only the
sustained conditions, the trends, and `BridgeMetricsAbsent` -- the one genuine
backstop, which fires when nothing is arriving at all, exactly the case where
Home Assistant is down and these automations cannot fire either.

Nothing is duplicated between the two. A channel that pages twice for one event
is a channel people learn to ignore.

## The exercise problem

The weekly exercise is the generator working correctly, and it does not look
like it: measured on this unit, a run sits at 46.7Hz and 90V through several
minutes of low-speed warm-up.

`binfohub_generator_started` therefore waits 90 seconds of continuous running
before it judges anything. That is not a delay for its own sake -- an automation
condition is evaluated the instant its trigger fires, so if `engine_running`
asserts even a second before the controller sets its exercise bit, an immediate
rule reads exercising=off and pages for the weekly test. Ninety seconds lets
both bits settle, and also filters a crank that never became a run.

It is also gated on `utility_power_failure` being off. During a real outage the
generator starting is the correct response and is already covered by
`binfohub_utility_power_lost`, which fires immediately -- so a start is only
surprising while the grid is healthy. Without that gate, one outage produced two
notifications.

The 90s costs nothing because this alert is informational. Every genuinely
urgent condition has its own automation and none of them wait.

## What is deliberately NOT exercise-gated

Nothing shutdown-class, here or in Grafana. A failure to start, or a fault that
trips the machine during its weekly test, is the most valuable thing this system
can tell you -- finding it on a Tuesday is the entire point of exercising.
Suppressing it would make the one hour a week the generator actually runs the
one hour nobody is watching.

## The six

| id | fires on | level |
|---|---|---|
| `binfohub_utility_power_lost` | utility_power_failure asserts | time-sensitive |
| `binfohub_utility_power_restored` | it clears | active |
| `binfohub_generator_started` | 90s running, grid healthy, not exercising | time-sensitive |
| `binfohub_generator_failed_to_start` | engine or generator failed to start | **critical** |
| `binfohub_generator_shutdown` | any of 9 shutdown/protection alarms | **critical** |
| `binfohub_bridge_dark` | bridge unreachable, or bus silent, 5 min | time-sensitive |

Critical uses the iOS critical interruption level, which bypasses silent mode.
Reserved for the two states that mean "you have no standby power".

`binfohub_bridge_dark` keeps the two failures apart on purpose. They look
identical in Home Assistant -- values stop moving -- but "the ESP32 is not
answering" and "the ESP32 is fine and the generator has gone quiet on it" are
different faults at different ends of the install. The second is the one a naive
online check calls healthy.
