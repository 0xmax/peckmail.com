# Git Access

Every Peckmail workspace is backed by a real git repository. You can clone, pull, and push using standard git commands.

## Cloning your workspace

```
git clone https://x-token:YOUR_API_KEY@peckmail.com/git/PROJECT_ID
```

Replace `YOUR_API_KEY` with your `pp_` API key from Settings, and `PROJECT_ID` with your workspace ID.

## Finding your project ID

The project ID is the UUID in the URL when you have a workspace open — for example, `peckmail.com/p/8f315244-dee8-48c6-82c8-851f1e3b9e42`.

## Pushing changes

You can push changes from your local machine back to Peckmail:

```
git add .
git commit -m "Updated from local"
git push
```

Changes will appear in the Peckmail editor in real time.

## Auto-commits

Peckmail auto-commits your changes every 60 seconds with an AI-generated commit message. These commits show up in your git history alongside any manual commits you make.
