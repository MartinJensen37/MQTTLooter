# Changelog

Versions follow [Semantic Versioning](https://semver.org): major for breaking changes to saved data or behavior, minor for new features, patch for fixes.

## 1.0.0 - 2026-10-26

First release.

- MQTT 3.1.1 and 5 connections over TCP, TLS and WebSockets, with secrets in the OS credential store.
- Topic tree, message cards with automatic JSON formatting, plain log, disk history, content search and JSON/CSV export.
- Plots of any numeric JSON field, decoded protobuf or Sparkplug B metric.
- Publishing with MQTT 5 properties and message schemas.
- Recording and playback stored in a local database, with file import and export.
- Device simulation with per-signal timing and a publish timeline.
- Sparkplug B decoding, node state, commands and simulated edge nodes.
- Protobuf decoders, light and dark themes, split view and an About dialog.
