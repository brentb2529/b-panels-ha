# Reference copy (version-controlled) of the coordinator-owned dev-ha package
# Live location: dev-ha/config/packages/signature_scenes.yaml (loaded via homeassistant.packages).
# Defines the 6 signature scene scripts (low-hazard orchestration) + dev-demo backing entities + inert gated-actor helpers for the forced-check.
# Enable in dev: add to configuration.yaml ->  homeassistant:
    packages: !include_dir_named packages
