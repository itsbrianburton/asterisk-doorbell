# Asterisk Configuration Files

This directory contains the configuration files for an Asterisk server to work correctly with this integration.

<img src="../images/integration-details.svg" />

## How it Works
1. The front door's doorbell is configured to call extension 9000 on your Asterisk server. Extension 9000 connects the doorbell to the confbridge "front_door" as a normal user and plays on-hold music.  A timeout triggers to automatically hang up on the caller if there's no response after a certain number of seconds.
1. The Asterisk server asynchronously notifies Home Assistant via a webhook that someone is waiting in conf_bridge "front_door".
1. The webhook calls the service that updates the sensor entities.
1. An automation monitoring the call state uses browser_mod's notification service to notify all HA users of an incoming call.
1. An HA user answers the call, which calls extension 9001 and connects them to the confbridge "front_door" as an admin.  That has the effect of stopping the on-hold music and connecting the two people.  When the HA user leaves, it will automatically hang up on the caller.

