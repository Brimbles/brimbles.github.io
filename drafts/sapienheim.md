---
title: Sapienheim
date: 2026-09-29
summary: An AI companion mod for Valheim dedicated servers that follows, fights, gathers, crafts and builds, with Claude deciding what it says and does
thumbnail: assets/images/sapienheim/icon.png
---

Sapienheim is an AI companion for Valheim dedicated servers. You talk to it in chat, and it follows you, fights beside you, gathers, crafts and builds. It keeps working when nobody is nearby.

![The Sapienheim icon: a rune in a speech bubble](assets/images/sapienheim/icon.png)

## How It Works

There are two halves:

- **The mod** runs on the game server, written in C# with BepInEx, Harmony and Jötunn. It does the actual work: pathfinding, combat, gathering, crafting, building, portals, inventory, and saving everything. Every player needs the mod too, but their copy only shows the companion and passes chat along.
- **The agent** is a small Python program that runs next to the server. It turns chat and game events into tool calls for Claude (follow, gather, craft, build and so on) and sends Claude's choices back to the mod as commands. It also holds the companion's long-term memory.

Claude is only asked when something happens, never every frame, and there's a per-minute budget so the API bill stays sensible. Players never need a key of their own.

## What the Companion Can Do

- Follow, stay, or walk somewhere up to 5 km away, through portals if needed.
- Fight, dropping whatever it's doing to defend you.
- Pick up and hand over items, use chests, gather wood, stone and plants, and craft at stations. It won't chop or mine inside someone's ward.
- Build from templates like a hut or a ring of walls, name the places it builds, travel back to them and repair them.
- Keep its inventory through death, restarts and going off duty when everyone logs off. It levels up with its master and shows on the map.
- Remember players, places and past conversations, and speak up on its own at dusk, when it's hurt, when it's bored or when you come back.

## Personality

The default companion is a friendly Viking with a dry wit. You can give it any persona you like with a text file. I've written two: Alvar the Barbarian, a deadpan, muscle-bound barbarian with matching voice clips, and a pompous skald in the style of Alan Partridge.

## Try It

The mod is on [Thunderstore](https://thunderstore.io/c/valheim/p/brimbles_sapienheim/Sapienheim/) and the agent is a Docker image. You need your own dedicated server and a Claude API key. The code and install guide are on GitHub: [Brimbles/sapienheim](https://github.com/Brimbles/sapienheim).

It's experimental: it works on my server, but expect rough edges.
