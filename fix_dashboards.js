const fs = require('fs');

function fixAndFormatJSON() {
  const dir = 'metabase_dashboards';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const path = dir + '/' + file;
    let content = fs.readFileSync(path, 'utf8');

    // Basic fix for trailing commas
    content = content.replace(/,(\s*[\]}])/g, '$1');

    let json;
    try {
      json = JSON.parse(content);
    } catch (e) {
      console.error('Syntax error parsing', path, e.message);
      continue;
    }

    let changed = false;

    if (json.cards) {
      for (const card of json.cards) {
        if (card.dataset_query && card.dataset_query.native && card.dataset_query.native.query) {
          if (card.dataset_query.native.query.includes('document_type')) {
            card.dataset_query.native.query = card.dataset_query.native.query.replace(/document_type/g, 'document_kind');
            changed = true;
          }
        }

        const techCols = ['clinic_id', 'clinic_jid', 'jid', 'transaction_id', 'original_log_id', 'service_id'];
        
        for (const col of techCols) {
          // If the query references the column (roughly)
          if (card.dataset_query.native.query && (card.dataset_query.native.query.includes(col) || card.dataset_query.native.query.includes(col.toUpperCase()))) {
            if (!card.visualization_settings) {
              card.visualization_settings = {};
            }
            if (!card.visualization_settings.column_settings) {
              card.visualization_settings.column_settings = {};
            }
            
            const key = '["name","' + col + '"]';
            if (!card.visualization_settings.column_settings[key] || card.visualization_settings.column_settings[key].display_as !== null) {
              card.visualization_settings.column_settings[key] = { display_as: null };
              changed = true;
            }
          }
        }
      }
    }

    if (changed) {
      fs.writeFileSync(path, JSON.stringify(json, null, 2));
      console.log('Updated and fixed:', path);
    } else {
      console.log('No changes needed:', path);
    }
  }
}

fixAndFormatJSON();