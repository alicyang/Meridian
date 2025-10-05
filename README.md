# HelpMyMom Chrome Extension

AI-powered assistant for non-native English speakers to understand complex websites.

## Features

- **Highlight → Explain**: Right-click any selected text to get simple explanations
- **Context-Aware**: Uses Chrome's Built-in AI (Gemini Nano) for fast, private processing
- **Fallback Support**: Automatically switches to remote Gemini Pro for complex requests
- **Beautiful UI**: Modern tooltips with smooth animations
- **Settings Panel**: Configure language preferences and AI settings
- **Usage Statistics**: Track your learning progress

## Installation

### For Development

1. **Clone or download** this repository
2. **Open Chrome** and go to `chrome://extensions/`
3. **Enable Developer mode** (toggle in top right)
4. **Click "Load unpacked"** and select this folder
5. **Pin the extension** to your toolbar for easy access

### For Production

1. **Visit Chrome Web Store** (coming soon)
2. **Click "Add to Chrome"**
3. **Start using** on any website!

## How to Use

### Basic Usage

1. **Select text** on any website (highlight with mouse)
2. **Right-click** on the selected text
3. **Choose "Explain this text"** from the context menu
4. **Read the explanation** in the tooltip that appears
5. **Click "Close"** or press Escape to dismiss

### Advanced Features

- **Get Better Explanation**: Click the button in the tooltip for a more detailed explanation using remote AI
- **Settings**: Click the extension icon to open settings panel
- **Language**: Choose your preferred language for explanations
- **AI Mode**: Toggle between local (faster) and remote (more capable) AI

## Technical Details

### Architecture

- **Manifest V3**: Modern Chrome extension architecture
- **Content Scripts**: Injected into web pages for text selection
- **Background Service Worker**: Handles API calls and context menus
- **Chrome Built-in AI**: Uses Gemini Nano for local processing
- **Fallback API**: Remote Gemini Pro for complex requests

### File Structure

```
HelpMyMom/
├── manifest.json          # Extension configuration
├── background.js          # Service worker for API calls
├── content.js            # Content script for text selection
├── content.css           # Styling for tooltips
├── popup.html            # Settings interface
├── popup.js              # Settings logic
└── README.md             # This file
```

### API Integration

The extension uses Chrome's Built-in AI APIs:

```javascript
// Local AI (Gemini Nano)
const prompt = await ai.prompt.create({
  systemPrompt: "Explain text in simple English for non-native speakers"
});
const result = await prompt.prompt(selectedText);

// Remote AI (Gemini Pro) - Fallback
const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ contents: [{ parts: [{ text: selectedText }] }] })
});
```

## Development

### Prerequisites

- Chrome browser (version 88+)
- Basic knowledge of Chrome extensions
- JavaScript knowledge

### Local Development

1. **Make changes** to the code
2. **Reload extension** in `chrome://extensions/`
3. **Test on websites** with complex text
4. **Check console** for any errors

### Testing

Test the extension on these types of websites:

- **Government sites**: Complex forms and legal language
- **Academic sites**: Course descriptions and requirements
- **Healthcare sites**: Medical terminology and procedures
- **Business sites**: Financial documents and contracts

### Debugging

- **Open DevTools** on any webpage
- **Check Console** for extension errors
- **Inspect tooltips** for styling issues
- **Test context menu** functionality

## Contributing

### Issues

- **Bug reports**: Describe the issue and steps to reproduce
- **Feature requests**: Explain the use case and expected behavior
- **Pull requests**: Follow the existing code style

### Code Style

- **ES6+ JavaScript**: Use modern syntax
- **Consistent formatting**: 2 spaces, semicolons
- **Clear comments**: Explain complex logic
- **Error handling**: Always handle API failures gracefully

## Roadmap

### Phase 1: Core Features ✅
- [x] Highlight → Explain functionality
- [x] Context menu integration
- [x] Beautiful tooltip UI
- [x] Settings panel
- [x] Usage statistics

### Phase 2: Enhanced Features
- [ ] Highlight → Translate functionality
- [ ] Highlight → Summarize functionality
- [ ] Hover tooltips for UI elements
- [ ] Glossary building
- [ ] Text rewriting

### Phase 3: Advanced Features
- [ ] Floating assistant chat
- [ ] History panel
- [ ] Multi-language support
- [ ] Offline mode
- [ ] User analytics

## Support

### Common Issues

**Extension not working?**
- Check if it's enabled in `chrome://extensions/`
- Try reloading the extension
- Check browser console for errors

**Tooltips not appearing?**
- Make sure you're selecting text first
- Check if the website blocks content scripts
- Try on a different website

**AI not responding?**
- Check your internet connection
- Try the "Get better explanation" button
- Check extension settings

### Contact

- **GitHub Issues**: Report bugs and request features
- **Email**: [Your email here]
- **Discord**: [Your Discord here]

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- **Google Chrome Team** for Built-in AI APIs
- **Gemini AI** for powerful language understanding
- **Open Source Community** for inspiration and tools
- **Non-native English speakers** for feedback and testing

---

**Made with ❤️ for non-native English speakers everywhere**
