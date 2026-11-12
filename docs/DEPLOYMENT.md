# Deployment

## Deployment model

The repository is a static Netlify site with:

- no build command;
- no dependency installation;
- publish directory `.`;
- configuration in `netlify.toml`.

Repository:

```text
https://github.com/yuvrajrainamastek/governance-script-studio
```

## Connect GitHub to Netlify

1. Sign in to Netlify.
2. Choose **Add new project** → **Import an existing project**.
3. Select GitHub and authorize access to the repository if required.
4. Select `yuvrajrainamastek/governance-script-studio`.
5. Use branch `main`.
6. Leave the build command empty.
7. Use publish directory `.`. Netlify should read this from `netlify.toml`.
8. Deploy.

Every push to `main` will create a production deployment unless the Netlify project is configured differently.

## Recommended Netlify settings

- Enable deploy previews for pull requests.
- Protect production changes through pull-request review.
- Do not add environment variables; the site has no secrets.
- Keep form handling, functions and identity disabled unless a reviewed requirement introduces them.
- Apply organizational access controls if the schema catalogue should not be public.

## Local preview

```powershell
git clone https://github.com/yuvrajrainamastek/governance-script-studio.git
cd governance-script-studio
python -m http.server 8080
```

Open:

```text
http://localhost:8080
```

Stop the server with `Ctrl+C`.

## Manual archive deployment

Although Git-connected deployment is preferred, a manual Netlify upload can contain:

```text
index.html
styles.css
app.js
favicon.svg
netlify.toml
README.md
CONTRIBUTING.md
data/catalog.json
docs/*
```

`index.html` must be at the root of the uploaded archive.

## Post-deployment verification

1. Confirm the home page loads without console errors.
2. Search for `DUTCHIE_LOYALTY_REGISTRATION`.
3. Confirm the table shows the expected catalogue columns.
4. Copy the live-schema query.
5. Export and re-import a draft configuration.
6. Complete a non-production test configuration.
7. Generate eight files.
8. Preview at least files 2, 3 and 5.
9. Download one SQL file and the ZIP.
10. Confirm the ZIP contains exactly eight `.sql` files.

## Troubleshooting

### Catalogue load error

Opening `index.html` with `file://` can block `fetch`. Use HTTP or the deployed Netlify URL.

### Blank table list

Verify that `/data/catalog.json` returns HTTP 200 and valid JSON.

### Netlify 404 at root

Confirm the repository root is the publish directory and `index.html` is not nested in another folder.

### Drafts missing

Drafts are browser-local. They do not move between browsers unless exported as JSON.

### Clipboard unavailable

Clipboard access can be denied by browser permissions. The remainder of the application still works.

## Rollback

Netlify retains previous deploys. Roll back the site using Netlify's deploy history, then revert the corresponding Git commit so the repository and deployed state remain aligned.
