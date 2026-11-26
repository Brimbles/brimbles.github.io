---
title: LCARS Home Dashboard
date: 2026-11-22
summary: A Star Trek style control panel for Home Assistant on a wall tablet, with lights, heating, the car, energy costs and a family map
thumbnail: assets/images/lcars-dashboard/main.png
---

A wall-mounted tablet that runs the house, styled like the LCARS computer screens from Star Trek. It's a custom Home Assistant card, so every button and number is live: lights, heating, the car charger, energy use and where everyone is.

You can try it below. The demo runs the real dashboard code with a made-up house, so press anything you like.

<span class="demo-frame"><iframe src="../lcars/" title="Interactive LCARS dashboard demo" loading="lazy"></iframe></span><script>(function () { function fit() { document.querySelectorAll('.demo-frame').forEach(function (b) { b.firstChild.style.transform = 'scale(' + b.clientWidth / 1280 + ')'; }); } fit(); addEventListener('resize', fit); addEventListener('load', fit); })();</script>

[Open the demo full screen](../lcars/)

## Pages

The buttons down the left side switch between pages.

![The main page: lights, a kitchen timer, the robot vacuum, room temperatures and heating boosts](assets/images/lcars-dashboard/main.png)

- Main: lights and scenes, a kitchen timer, room temperatures, heating boosts and the robot vacuum
- Car: charge level, charge limit, defrost, departure times, tyres and locks, and how much home charging has cost since payday
- Family: a map showing where everyone is, how far from home and whether they're heading back
- Energy: today's cost (estimated, because the meter data arrives a day or two late), 30 days of electricity and gas, which devices use the most over the last day, week or month, and the biggest spikes
- Forecast: what each device would cost over a whole month at its recent rate of use, and for past months what each device actually used, with the total set against what Octopus charged
- Server: CPU, memory, disks and Docker containers on the home server
- Terminal: the same controls in a green-screen terminal style

![The car page](assets/images/lcars-dashboard/car.png)

![The energy page, with daily costs and the devices using the most](assets/images/lcars-dashboard/energy.png)

![The forecast page, with what each device costs per month at its recent rate of use](assets/images/lcars-dashboard/forecast.png)

![The family map](assets/images/lcars-dashboard/family.png)

![The server page](assets/images/lcars-dashboard/server.png)

![The terminal version](assets/images/lcars-dashboard/terminal.png)

## How It Works

- It's one JavaScript file that defines two custom Home Assistant cards, LCARS and terminal, with no build step or framework
- A small Node script uploads the card and the dashboard layout to Home Assistant over its websocket API, so nothing has to be copied onto the server
- The layout (which buttons, rooms and devices) lives in one JSON file, separate from the code
- An old Amazon Fire tablet runs it full screen in Fully Kiosk Browser, and the screen wakes when someone walks past
- Buttons make LCARS-style beeps, and pressing one reads out what it did
- The energy page fits a straight line of daily gas use against outdoor temperature, so it can estimate today's cost before the meter readings arrive

## Try It

The demo is here: [LCARS Home Dashboard demo](../lcars/)
