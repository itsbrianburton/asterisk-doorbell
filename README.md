# Asterisk Doorbell Integration

This was inspired by TECH7Fox's excellent [Asterisk Integration](https://github.com/TECH7Fox/Asterisk-integration), but written from the ground up to improve a few pain points:
* Uses Browser Mod to notify specific HA clients rather than creating multiple persons.
* Maintains a connection to the Asterisk server while using HA for faster responses.
* Uses confbridges (conference calls) to take advantage

### How It's Different


<img src="images/integration-details.svg" />


## Requirements
* [HACS](https://www.hacs.xyz/docs/use/download/download/#to-download-hacs-ossupervised) - **(Required)** Necessary to install the following integrations
* [Browser Mod](https://github.com/thomasloven/hass-browser_mod) - **(Required)** Used to identify individual HA instances and send users directly to the correct dashboard to answer a call.
* Asterisk Server - **(Requuired)**

## Installation

### 1. Install HACS
1. Follow the instructions found [here](https://www.hacs.xyz/docs/use/download/download/#to-download-hacs)

### 2. Install Browser Mod, if not already installed
1. Open HACS
1. Search for and install Browser Mod
1. On each device that runs Home Assistant, do the following:
   1. Click on Browser Mod in the left hand menu
   2. Give each device a unique browser ID.  i.e. beth_laptop
   3. Disable Auto-register as you should only register the browsers you want registered
   4. Repeat this procedure on every device that HA is installed on.

**Important**: Complete the above installation and configuration before moving forward.

### 3. Install Asterisk Addon/VM
1. Install the Addon or VM
1. Complete the configuration by referencing the files in the asterisk directory.
1. Start the Asterisk server

### 4. Install this integration
 1. Go to HACS
 2. Click on the 3 points in the upper right corner and click on `Custom repositories`
 3. Paste (https://github.com/itsbrianburton/asterisk-doorbell/ into `Add custom repository URL` and by category choose Integration
 4. Click on add and check if the repository is there.
 5. You should now see Asterisk integration. Click `INSTALL`
 6. Restart Home Assistant.
 7. Go to integrations and find Asterisk.
 8. Fill in the fields and click add. If successful, you should now see your PJSIP/SIP devices.
