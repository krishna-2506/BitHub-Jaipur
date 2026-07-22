const { queryDB, primaryPool } = require('./db');

(async () => {
  try {
    const qs = await queryDB("SELECT id, subject_code FROM questions WHERE subject_code = 'CH24101' AND module = 'None'");
    if (!qs || qs.length === 0) { 
        console.log('No questions to fix.'); 
        process.exit(0);
    }
    
    // Convert to array if it returned a single object
    const rows = Array.isArray(qs) ? qs : [qs];
    
    let count = 0;
    for (let i = 0; i < rows.length; i++) {
      const mod = (i % 5) + 1; // 1, 2, 3, 4, 5
      await primaryPool.query(`UPDATE questions SET module = '${mod}' WHERE id = ${rows[i].id}`);
      count++;
    }
    console.log('Fixed ' + count + ' Chemistry questions!');
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();
