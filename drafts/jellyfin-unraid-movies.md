---
title: Adding a Movies Share to Jellyfin on Unraid
date: 2026-11-22
summary: How to get an Unraid share into a Jellyfin library, and why Jellyfin can't see it until you map it into the container
thumbnail: assets/images/jellyfin-unraid-movies/thumbnail.png
---

I've set up Jellyfin on my Unraid server. The first thing that caught me out was that Jellyfin couldn't see my movies share at all. This is how to fix that.

![A NAS sending films to a play button](assets/images/jellyfin-unraid-movies/thumbnail.png)

## Why Jellyfin Can't See Your Shares

On Unraid, Jellyfin runs in a Docker container, and a container only sees the folders you've passed into it. Getting a share into a library takes two steps: map the share into the container in Unraid, then add that folder to the library in Jellyfin.

## Step 1: Map the Share into the Container (Unraid)

- Open the **Docker** tab, click the Jellyfin icon and choose **Edit**.
- Check the existing paths first. Some Jellyfin templates already map a media path, such as <code>/data/movies</code> or <code>/media</code>. If one already points at your Movies share, skip to step 2.
- Otherwise, scroll to the bottom and click **Add another Path, Port, Variable, Label or Device**.
- Set **Config Type** to Path and **Name** to Movies.
- Set **Container Path** to <code>/data/movies</code>. This is the name Jellyfin will see, so it can be anything.
- Set **Host Path** to your share, e.g. <code>/mnt/user/Movies</code>.
- Set **Access Mode** to Read Only. Jellyfin only needs to read the files, and this keeps them safe.
- Click **Add**, then **Apply**. The container restarts with the new folder.

## Step 2: Add the Folder to the Library (Jellyfin)

- Open Jellyfin in a browser (e.g. <code>http://tower:8096</code>) and go to **Dashboard**, then **Libraries**.
- If you already have a Movies library, click its menu and choose **Manage library**. Click **+** next to **Folders**, pick <code>/data/movies</code> and save.
- If you don't have one yet, click **Add Media Library**, set **Content type** to **Movies**, add <code>/data/movies</code> under **Folders** and click **OK**.

Jellyfin then scans the folder. A big collection can take a while the first time; you can watch the progress on the Dashboard.

## If the Folder Isn't There

If <code>/data/movies</code> doesn't show up in Jellyfin's folder picker, the mapping didn't take. Check the container path in the Docker template and make sure the container restarted.

Don't go looking under <code>/mnt/user</code> inside Jellyfin. The container only sees the container paths you've mapped, not Unraid's own folders.

## Same Again for Music

The same two steps work for any other share. For music, map it to something like <code>/data/music</code> and make a library with **Content type** set to **Music**.
