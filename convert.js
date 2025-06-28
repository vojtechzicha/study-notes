// convert.js - THE FINAL, STATEFUL VERSION
// This script now uses a manifest.json to perfectly preserve original filenames,
// solving all casing and diacritic issues for sources with "update: false".

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const CONFIG_PATH = './config.json'
const LUA_FILTER_PATH = './remove-toc.lua'
const CSS_PATH = './styles.css'
const JS_LOADER_PATH = './katex-loader.js'
const MASTER_TEMPLATE_PATH = './template.html'
const MANIFEST_NAME = 'manifest.json' // The name of our new database file

async function main() {
  console.log('🚀 Starting Study Hub build process (Final Stateful Version)...')

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  const { sources, outputDir } = config

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  // Copy site-wide assets
  fs.copyFileSync(CSS_PATH, path.join(outputDir, 'styles.css'))
  fs.copyFileSync(JS_LOADER_PATH, path.join(outputDir, 'katex-loader.js'))
  console.log(`🎨 Copied site-wide assets (CSS, JS) to ${outputDir}`)

  // --- NEW: MANIFEST LOGIC ---
  const manifestPath = path.join(outputDir, MANIFEST_NAME)
  let manifest = {}
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  }
  // --- END OF NEW LOGIC ---

  const siteStructure = []

  for (const source of sources) {
    const directoryFiles = { directoryName: source.name, files: [] }
    const sourceSlug = slugify(source.name)

    if (!source.update) {
      console.log(`\n⏭️  Skipping directory (reading from manifest): "${source.name}"`)
      // Find files in the manifest that belong to this source
      for (const htmlName in manifest) {
        if (htmlName.startsWith(sourceSlug + '-')) {
          const stats = fs.existsSync(path.join(outputDir, htmlName)) ? fs.statSync(path.join(outputDir, htmlName)) : { mtimeMs: 0 }
          directoryFiles.files.push({
            originalName: manifest[htmlName], // Get the PERFECT name from the manifest
            htmlName: htmlName,
            modifiedTime: stats.mtimeMs,
          })
        }
      }
      if (directoryFiles.files.length > 0) {
        console.log(`   -> Found ${directoryFiles.files.length} previously converted files in manifest.`)
        siteStructure.push(directoryFiles)
      }
      continue
    }

    console.log(`\n🔄 Processing directory for updates: "${source.name}"`)
    if (!fs.existsSync(source.path)) {
      console.warn(`⚠️ Warning: Directory not found, skipping: ${source.path}`)
      continue
    }

    const docxFiles = fs.readdirSync(source.path).filter(file => file.toLowerCase().endsWith('.docx'))
    if (docxFiles.length === 0) continue

    for (const docxFile of docxFiles) {
      const originalDocxPath = path.join(source.path, docxFile)
      const baseName = path.basename(docxFile, '.docx') // This has correct casing and diacritics
      const safeHtmlName = `${sourceSlug}-${slugify(baseName)}.html`
      const outputHtmlPath = path.join(outputDir, safeHtmlName)
      const tempHtmlPath = outputHtmlPath + '.temp'

      let shouldConvert = true
      if (fs.existsSync(outputHtmlPath)) {
        const docxStats = fs.statSync(originalDocxPath)
        const htmlStats = fs.statSync(outputHtmlPath)
        if (docxStats.mtimeMs <= htmlStats.mtimeMs) shouldConvert = false
      }

      if (!shouldConvert) {
        console.log(`   -> Skipping "${baseName}" (no changes detected).`)
      } else {
        try {
          console.log(`   -> Converting "${baseName}"...`)
          const uniqueMediaSubdir = safeHtmlName.replace('.html', '_media')

          const pandocCommand = [
            'pandoc',
            `"${path.resolve(originalDocxPath)}"`,
            '-t',
            'html',
            '-s',
            '-o',
            `"${path.basename(tempHtmlPath)}"`,
            '--katex',
            '--toc',
            `--lua-filter="${path.resolve(LUA_FILTER_PATH)}"`,
            `--template="${path.resolve(MASTER_TEMPLATE_PATH)}"`,
            `--metadata=group-name:"${source.name}"`,
            `--extract-media="${uniqueMediaSubdir}"`,
          ].join(' ')

          execSync(pandocCommand, { stdio: 'pipe', encoding: 'utf-8', cwd: outputDir })
          fs.renameSync(path.join(outputDir, path.basename(tempHtmlPath)), outputHtmlPath)
          console.log(`   -> ✨ Successfully created "${safeHtmlName}"`)
        } catch (error) {
          console.error(`\n❌ FATAL ERROR during conversion of "${docxFile}".`)
          console.error(error.stderr || error.message)
          if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath)
          console.error('   Aborting script.')
          process.exit(1)
        }
      }

      // --- NEW: ALWAYS UPDATE THE MANIFEST AND SITE STRUCTURE ---
      const finalStats = fs.statSync(outputHtmlPath)
      manifest[safeHtmlName] = baseName // Record the correct name
      directoryFiles.files.push({
        originalName: baseName, // Use the correct name
        htmlName: safeHtmlName,
        modifiedTime: finalStats.mtimeMs,
      })
    }
    if (directoryFiles.files.length > 0) {
      siteStructure.push(directoryFiles)
    }
  }

  // --- NEW: ALWAYS SAVE THE UPDATED MANIFEST ---
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log('\n💾 Manifest saved.')

  console.log('\n📄 Generating index.html...')
  const indexHtmlContent = generateIndexHtml(siteStructure)
  fs.writeFileSync(path.join(outputDir, 'index.html'), indexHtmlContent)

  console.log('\n✅ All done! Your Study Hub is complete and robust.')
}

// --- HELPER FUNCTIONS (Unchanged from previous versions) ---
// The generateIndexHtml, slugify, etc. functions remain the same.

function slugify(text) {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
}

function generateIndexHtml(structure) {
  structure.sort((a, b) => a.directoryName.localeCompare(b.directoryName))
  const now = Date.now()
  const recentThreshold = 90 * 24 * 60 * 60 * 1000
  const activeThreshold = 210 * 24 * 60 * 60 * 1000

  let allFiles = []
  structure.forEach(dir => {
    dir.files.forEach(file => {
      allFiles.push({ ...file, directoryName: dir.directoryName })
    })
  })

  const activeFiles = allFiles.filter(file => now - file.modifiedTime < activeThreshold).sort((a, b) => b.modifiedTime - a.modifiedTime)

  let activeFilesHtml = ''
  if (activeFiles.length > 0) {
    activeFilesHtml += `<div class="active-files-group" data-directory-name="nedávno aktualizované"><h2>Nedávno aktualizované</h2><ul>`
    activeFiles.forEach(file => {
      activeFilesHtml += `
            <li data-file-name="${file.originalName.toLowerCase()}" data-directory-name="${file.directoryName.toLowerCase()}">
                <a href="./${file.htmlName}">
                    ${file.originalName}
                    <span class="file-group-name">(${file.directoryName})</span>
                </a>
            </li>`
    })
    activeFilesHtml += `</ul></div>`
  }

  let fileListHtml = ''
  for (const dir of structure) {
    dir.files.sort((a, b) => a.originalName.localeCompare(b.originalName))
    fileListHtml += `<div class="directory-group" data-directory-name="${dir.directoryName.toLowerCase()}"><h2>${
      dir.directoryName
    }</h2><ul>`
    for (const file of dir.files) {
      const isRecent = now - file.modifiedTime < recentThreshold
      const badge = isRecent ? ' <span class="badge">NOVÉ</span>' : ''
      fileListHtml += `<li data-file-name="${file.originalName.toLowerCase()}"><a href="./${file.htmlName}">${
        file.originalName
      }</a>${badge}</li>`
    }
    fileListHtml += `</ul></div>`
  }

  return `
<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Univerzitní studium - materiály a přednášky</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>Univerzitní studium - materiály a přednášky</h1>
        <input type="text" id="searchInput" placeholder="Hledat v poznámkách...">
        ${activeFilesHtml}
        <div id="file-list">${fileListHtml}</div>
    </div>
    <script>
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            document.querySelectorAll('.directory-group, .active-files-group').forEach(group => {
                const groupName = group.dataset.directoryName || '';
                const files = group.querySelectorAll('li');
                let hasVisibleFile = false;
                
                if (group.classList.contains('active-files-group')) {
                    files.forEach(file => {
                        const fileName = file.dataset.fileName;
                        const dirName = file.dataset.directoryName;
                        const isVisible = fileName.includes(searchTerm) || dirName.includes(searchTerm);
                        file.style.display = isVisible ? '' : 'none';
                        if (isVisible) hasVisibleFile = true;
                    });
                } else {
                    files.forEach(file => {
                        const fileName = file.dataset.fileName;
                        const isVisible = fileName.includes(searchTerm) || groupName.includes(searchTerm);
                        file.style.display = isVisible ? '' : 'none';
                        if (isVisible) hasVisibleFile = true;
                    });
                }

                const isGroupVisible = groupName.includes(searchTerm) || hasVisibleFile;
                group.style.display = isGroupVisible ? '' : 'none';
            });
        });
    </script>
</body>
</html>`
}

main().catch(error => {
  console.error('❌ An unexpected error occurred:', error)
})
