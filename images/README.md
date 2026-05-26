# How to add real food photos

Once you've done a proper food photography shoot, you can replace the illustrated dish icons with real photos in 3 simple steps.

## Step 1: Prepare your photos

Recommended specs:
- **Format**: JPG (smaller file size) or WebP (best quality + size)
- **Dimensions**: 800 x 600 pixels (4:3 aspect ratio)
- **File size**: under 200 KB each (compress at tinypng.com or squoosh.app before adding)
- **Naming**: lowercase with hyphens, like `alfredo.jpg`, `pink-sauce.jpg`, `green-pasta.jpg`

## Step 2: Drop photos into this folder

Save your photos directly in this `/images` folder. So your structure becomes:

```
images/
├── alfredo.jpg
├── pink-sauce.jpg
├── green-pasta.jpg
├── garlic-bread.jpg
└── sausage-bruschetta.jpg
```

## Step 3: Tell the website to use them

Open `js/config.js` in VS Code. Find each menu item and change the `imageUrl` from `null` to the photo path.

**Before (using illustration):**
```javascript
{
  id: 'alfredo',
  name: 'Pasta Alfredo',
  imageUrl: null,   // <-- using illustration
  ...
}
```

**After (using your photo):**
```javascript
{
  id: 'alfredo',
  name: 'Pasta Alfredo',
  imageUrl: 'images/alfredo.jpg',   // <-- using your photo
  ...
}
```

Save the file. Refresh your browser. Done.

## Mixing photos and illustrations

You can use photos for some items and illustrations for others. Just leave `imageUrl: null` for items you don't have photos for yet.

## Tips for good food photos

1. **Natural daylight** from a window beats artificial light every time
2. **Top-down or 45-degree angle** works best for pasta
3. **White or dark wooden surface** as the background
4. **Garnish lightly** with herbs or parmesan for color
5. **Steam helps** — photograph immediately after plating
6. **Take 20+ shots per dish**, pick the 1-2 best ones
7. **Edit minimally** — just brightness and a touch of contrast, no filters

Cheap setup that works: a phone, a window, a wooden cutting board. That's all professional food photographers used before there was a budget.
