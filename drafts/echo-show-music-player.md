---
title: Echo Show 5 Music Player
date: 2026-11-25
summary: An old Echo Show 5 reflashed with LineageOS, now a Spotify speaker any phone can cast to, with one-tap playlists on a woodland home screen
---

An Amazon Echo Show 5, flashed with LineageOS so it runs plain Android instead of Alexa, turned into a kitchen music player. Tap a playlist on the home screen and it plays, or pick the Echo from Spotify on any phone in the house and play through it.


## What It Does

- One-tap playlists: each tile starts a Spotify playlist straight away
- A now-playing bar with the cover, song, artist and back, pause and skip buttons
- Casting from any phone: the Echo shows up in Spotify's device list as RimbleWarble, for any Premium account on the Wi-Fi, not just the one logged in on the Echo
- An Apps button for everything else, so Settings is still there when it's needed
- No lock screen: the top button goes straight to the home screen

## How It Works

- The home screen is a small Android app I wrote, replacing the normal launcher. It's built with a shell script instead of Gradle, because a whole Android Studio setup felt like a lot for one screen
- The Echo only has a 32-bit processor, so a lot of current apps won't install. Spotify still works, installed through Aurora Store
- A tile opens a special Spotify link that starts the playlist playing, then the home screen comes back once the song changes. Spotify ignored every attempt to start a playlist without coming to the front, and Android only lets an app bring itself back for a few seconds, so the timing took some fiddling
- The normal Spotify app only appears as a speaker to the account logged into it. Spotify's TV app would fix that, but it refuses to run on anything that isn't a TV. So RimbleWarble is librespot, an open-source Spotify Connect receiver, cross-compiled for 32-bit Android and wrapped in an app that starts it at boot and plays its audio through the speaker


## Credits

Background photo: "Puzzlewood" by Neil Barnwell, from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Puzzlewood_%283899465021%29.jpg), licensed [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/). Cropped and resized.

Spotify Connect receiver: [librespot](https://github.com/librespot-org/librespot).
