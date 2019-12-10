use std::collections::hash_map::Entry::Occupied;
use std::collections::hash_map::Entry::Vacant;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::collections::HashMap;
use std::env;
use std::fs::File;
use std::io::BufRead;
use std::io::BufReader;
use std::io::Write;
use std::rc::Rc;

extern crate env_logger;

extern crate tools;
use tools::config;
use tools::file_format::analysis::{read_analysis, read_source, read_target, AnalysisKind};
use tools::find_source_file;

extern crate rustc_serialize;
use rustc_serialize::json::{Json, ToJson};

#[derive(Clone, Debug)]
struct SearchResult {
    lineno: u32,
    bounds: (u32, u32),
    line: Rc<String>,
    context: Rc<String>,
    contextsym: Rc<String>,
    peek_lines: Rc<String>,
}

impl ToJson for SearchResult {
    fn to_json(&self) -> Json {
        let (st, en) = self.bounds;
        let bounds = vec![st, en];

        let mut obj = BTreeMap::new();
        obj.insert("lno".to_string(), self.lineno.to_json());
        obj.insert("bounds".to_string(), bounds.to_json());
        obj.insert("line".to_string(), self.line.to_json());
        obj.insert("context".to_string(), self.context.to_json());
        obj.insert("contextsym".to_string(), self.contextsym.to_json());
        if !self.peek_lines.is_empty() {
            obj.insert("peekLines".to_string(), self.peek_lines.to_json());
        }
        Json::Object(obj)
    }
}

/// SymbolMeta is extracted from the "def" AnalysisSource records for a symbol and stored in the
/// meta_table for the symbol.
struct SymbolMeta {
    /// The 2nd part of the syntax.  Ex: "function", "field", "type".
    syntax_kind: Rc<String>,
    type_pretty: Rc<String>,
    type_sym: Rc<String>,
    src_sym: Rc<String>,
    target_sym: Rc<String>,
    idl_sym: Rc<String>,
}

impl ToJson for SymbolMeta {
    fn to_json(&self) -> Json {
        let mut obj = BTreeMap::new();
        obj.insert("syntax".to_string(), self.syntax_kind.to_json());
        obj.insert("type".to_string(), self.type_pretty.to_json());
        obj.insert("typesym".to_string(), self.type_sym.to_json());
        obj.insert("srcsym".to_string(), self.src_sym.to_json());
        obj.insert("targetsym".to_string(), self.target_sym.to_json());
        obj.insert("idlsym".to_string(), self.idl_sym.to_json());
        Json::Object(obj)
    }
}

fn split_scopes(id: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut start = 0;
    let mut argument_nesting = 0;
    for (index, m) in id.match_indices(|c| c == ':' || c == '<' || c == '>') {
        if m == ":" && argument_nesting == 0 {
            if start != index {
                result.push(id[start..index].to_owned());
                start = index + 1;
            } else {
                start = index + 1;
            }
        } else if m == "<" {
            argument_nesting += 1;
        } else if m == ">" {
            argument_nesting -= 1;
        }
    }
    result.push(id[start..].to_owned());
    return result;
}

struct StringIntern {
    set: HashMap<Rc<String>, ()>,
}

impl StringIntern {
    fn new() -> StringIntern {
        StringIntern {
            set: HashMap::new(),
        }
    }

    fn add(&mut self, s: String) -> Rc<String> {
        let new_rc = Rc::new(s);
        match self.set.entry(new_rc) {
            Occupied(o) => Rc::clone(&o.key()),
            Vacant(v) => {
                let rval = Rc::clone(&v.key());
                v.insert(());
                rval
            }
        }
    }
}

/// Process all analysis files, deriving the `crossref`, `jumps`, and `identifiers` output files.
/// See https://github.com/mozsearch/mozsearch/blob/master/docs/crossref.md for high-level
/// documentation on how this works (locally, `docs/crossref.md`).
///
/// ## Implementation
/// There are 2 phases of processing:
/// 1. The analysis files are read, populating `table`, `pretty_table`, `id_table`, and
///    `meta_table` incrementally.  Primary cross-reference information comes from target records,
///    but the file is also processed for source records in order to populate `meta_table` with
///    meta-information about the symbol.
/// 2. The table is consumed with jumps generated as a byproduct.
///
/// ### Memory Management
/// Memory usage grows continually throughout phase 1.  Because we load many identical strings,
/// we use string interning so that all long-lived strings are reference-counted interned strings.
fn main() {
    env_logger::init();
    let args: Vec<_> = env::args().collect();

    let cfg = config::load(&args[1], false);

    let tree_name = &args[2];
    let tree_config = cfg.trees.get(tree_name).unwrap();

    let filenames_file = &args[3];

    let file_paths: Vec<String> = BufReader::new(File::open(filenames_file).unwrap())
        .lines()
        .map(|x| x.unwrap())
        .collect();
    let output_file = format!("{}/crossref", tree_config.paths.index_path);
    let jump_file = format!("{}/jumps", tree_config.paths.index_path);
    let id_file = format!("{}/identifiers", tree_config.paths.index_path);

    let mut strings = StringIntern::new();
    let empty_string = strings.add("".to_string());

    // Nested table hierarchy keyed by: [symbol, kind, path] with Vec<SearchResult> as the leaf
    // values.
    let mut table = BTreeMap::new();
    // Maps (raw) symbol to interned-pretty symbol string.  Each raw symbol is unique, but there
    // may be many raw symbols that map to the same pretty symbol string.
    let mut pretty_table = HashMap::new();
    // Reverse of pretty_table.  The key is the pretty symbol, and the value is a BTreeSet of all
    // of the raw symbols that map to the pretty symbol.  Pretty symbols that start with numbers or
    // include whitespace are considered illegal and not included in the map.
    let mut id_table = BTreeMap::new();
    // Maps (raw) symbol to `SymbolMeta` info for this symbol.  This information is currently
    // extracted from the source records during an additional pass of the analysis file, looking
    // only at defs.  However, in the future, this will likely come from a new type of record.
    let mut meta_table = BTreeMap::new();
    // Maps (raw) symbol to a BTreeSet of the (raw) symbols it consumes.
    let mut consumes_table = BTreeMap::new();
    // Not populated until phase 2 when we walk the above data-structures.
    let mut jumps = Vec::new();

    // As we process the source entries and build the SourceMeta, we keep a running list of what
    // IPC symbols need to be linked.  We then process this after all of the files have been
    // processed.  We do this primarily because we can't mutate meta_table while we traverse it.
    let mut ipc_to_link = Vec::new();

    for path in &file_paths {
        print!("File {}\n", path);

        let analysis_fname = format!("{}/analysis/{}", tree_config.paths.index_path, path);
        let analysis = read_analysis(&analysis_fname, &mut read_target);

        // Load the source file and chop it up into `lines` so that we extract `peek_lines` for
        // each symbol with a peek_range.
        let source_fname = find_source_file(path, &tree_config.paths.files_path, &tree_config.paths.objdir_path);
        let source_file = match File::open(source_fname) {
            Ok(f) => f,
            Err(_) => {
                println!("Unable to open source file");
                continue;
            }
        };
        let reader = BufReader::new(&source_file);
        let lines: Vec<_> = reader
            .lines()
            .map(|l| match l {
                Ok(line) => {
                    let line_cut = line.trim_end();
                    let len = line_cut.len();
                    let line_cut = line_cut.trim_start();
                    let offset = (len - line_cut.len()) as u32;
                    let buf = line_cut.chars().take(100).collect();
                    (strings.add(buf), offset)
                }
                Err(_) => (Rc::clone(&empty_string), 0),
            })
            .collect();

        for datum in analysis {
            // pieces are all `AnalysisTarget` instances.
            for piece in datum.data {
                let sym = strings.add(piece.sym.to_owned());
                let contextsym = strings.add(piece.contextsym.to_owned());
                let t1 = table.entry(Rc::clone(&sym)).or_insert(BTreeMap::new());
                let t2 = t1.entry(piece.kind.clone()).or_insert(BTreeMap::new());
                let p: &str = &path;
                let t3 = t2.entry(p).or_insert(Vec::new());
                let lineno = (datum.loc.lineno - 1) as usize;
                if lineno >= lines.len() {
                    print!("Bad line number in file {} (line {})\n", path, lineno);
                    continue;
                }

                let (line, offset) = lines[lineno].clone();

                let peek_start = piece.peek_range.start_lineno;
                let peek_end = piece.peek_range.end_lineno;
                let mut peek_lines = String::new();
                if peek_start != 0 {
                    // The offset of the first non-whitespace
                    // character of the first line of the peek
                    // lines. We want all the lines in the peek lines
                    // to be cut to this offset.
                    let left_offset = lines[(peek_start - 1) as usize].1;

                    for peek_line_index in peek_start .. peek_end + 1 {
                        let &(ref peek_line, peek_offset) = &lines[(peek_line_index - 1) as usize];

                        for _i in left_offset .. peek_offset {
                            peek_lines.push(' ');
                        }
                        peek_lines.push_str(&peek_line);
                        peek_lines.push('\n');
                    }
                }

                // Idempotently insert the symbol -> pretty symbol mapping into `pretty_table`.
                let pretty = strings.add(piece.pretty.to_owned());
                pretty_table.insert(Rc::clone(&sym), Rc::clone(&pretty));

                // If this is a use and there's a contextsym, we want to create a "Consume"
                // entry under the contextsym.  We also want to invert the use of "context"
                // to be the symbol in question; it's not useful to name the context symbol
                // redundantly when it's the symbol we're attaching data to.
                if piece.kind == AnalysisKind::Use && !contextsym.is_empty() {
                    let consumed = consumes_table.entry(Rc::clone(&contextsym)).or_insert(BTreeSet::new());
                    consumed.insert(Rc::clone(&sym));
                }

                t3.push(SearchResult {
                    lineno: datum.loc.lineno,
                    bounds: (datum.loc.col_start - offset, datum.loc.col_end - offset),
                    line: line,
                    context: strings.add(piece.context),
                    contextsym: contextsym,
                    peek_lines: strings.add(peek_lines),
                });

                // Idempotently insert the pretty symbol -> symbol mapping as long as the pretty
                // symbol looks sane.  (Whitespace breaks the `identifiers` file's text format, so
                // we can't include them.)
                let ch = piece.sym.chars().nth(0).unwrap();
                if !(ch >= '0' && ch <= '9') && !piece.sym.contains(' ') {
                    let t1 = id_table.entry(pretty).or_insert(BTreeSet::new());
                    t1.insert(sym);
                }
            }
        }

        let source_analysis = read_analysis(&analysis_fname, &mut read_source);
        for datum in source_analysis {
            // pieces are all `AnalysisSource` instances.
            for piece in datum.data {
                if piece.is_def() {
                    if piece.get_syntax_kind().is_some() {
                        meta_table.entry(strings.add(piece.sym[0].clone())).or_insert_with(|| {
                            if piece.is_ipc() {
                                ipc_to_link.push(strings.add(piece.sym[0].clone()));
                            }
                            SymbolMeta {
                                syntax_kind: strings.add(piece.get_syntax_kind().unwrap().to_string()),
                                type_pretty: strings.add(piece.type_pretty.unwrap_or("".to_string())),
                                type_sym: strings.add(piece.type_sym.unwrap_or("".to_string())),
                                src_sym: strings.add(piece.src_sym.unwrap_or("".to_string())),
                                target_sym: strings.add(piece.target_sym.unwrap_or("".to_string())),
                                idl_sym: Rc::clone(&empty_string),
                            }
                        });
                    }
                }
            }
        }
    }

    // ## Process the meta table for propagation.
    // ### Tasks
    // - For all "ipc" metas, establish an "idl_sym" up-link from their src_sym and target_sym to
    //   the ipc sym.  Also, each should have the respective src/target sym.
    //
    // ### How
    // Because we want to mutate the contents of the map and rust has (sensible) issues with
    // us mutating the map while we're traversing it, we perform a pass when we decide what symbols
    for ipc_sym in ipc_to_link {
        let (src_sym, target_sym) = match meta_table.get(&ipc_sym) {
            Some(ipc_meta) => (ipc_meta.src_sym.clone(), ipc_meta.target_sym.clone()),
            None => continue,
        };

        if let Some(src_meta) = meta_table.get_mut(&src_sym) {
            src_meta.idl_sym = ipc_sym.clone();
            src_meta.target_sym = target_sym.clone();
        }

        if let Some(target_meta) = meta_table.get_mut(&target_sym) {
            target_meta.idl_sym = ipc_sym.clone();
            target_meta.src_sym = src_sym.clone();
        }
    }


    // ## Write out the crossref database.
    let mut outputf = File::create(output_file).unwrap();

    for (id, id_data) in table {
        let mut kindmap = BTreeMap::new();
        for (kind, kind_data) in &id_data {
            let mut result = Vec::new();
            for (path, results) in kind_data {
                let mut obj = BTreeMap::new();
                obj.insert("path".to_string(), path.to_json());
                obj.insert("lines".to_string(), results.to_json());
                result.push(Json::Object(obj));
            }
            let kindstr = match *kind {
                AnalysisKind::Use => "uses",
                AnalysisKind::Def => "defs",
                AnalysisKind::Assign => "assignments",
                AnalysisKind::Decl => "decls",
                AnalysisKind::Idl => "idl",
                AnalysisKind::IPC => "ipc",
            };
            kindmap.insert(kindstr.to_string(), Json::Array(result));
        }
        if let Some(consumed_syms) = consumes_table.get(&id) {
            let mut consumed = Vec::new();
            for consumed_sym in consumed_syms {
                if let Some(meta) = meta_table.get(consumed_sym) {
                    let mut obj = BTreeMap::new();
                    obj.insert("sym".to_string(), consumed_sym.to_json());
                    if let Some(pretty) = pretty_table.get(consumed_sym) {
                        obj.insert("pretty".to_string(), pretty.to_json());
                    }
                    obj.insert("syntax".to_string(), meta.syntax_kind.to_json());
                    consumed.push(Json::Object(obj));
                }
            }
            kindmap.insert("consumes".to_string(), consumed.to_json());
        }
        // Put the metadata in there too.
        if let Some(meta) = meta_table.get(&id) {
            kindmap.insert("meta".to_string(), meta.to_json());
        }

        let kindmap = Json::Object(kindmap);

        let _ = outputf.write_all(format!("{}\n{}\n", id, kindmap.to_string()).as_bytes());

        if id_data.contains_key(&AnalysisKind::Def) {
            let defs = id_data.get(&AnalysisKind::Def).unwrap();
            if defs.len() == 1 {
                for (path, results) in defs {
                    if results.len() == 1 {
                        let mut v = Vec::new();
                        v.push(id.to_json());
                        v.push(path.to_json());
                        v.push(results[0].lineno.to_json());
                        let pretty = pretty_table.get(&id).unwrap();
                        v.push(pretty.to_json());
                        jumps.push(Json::Array(v));
                    }
                }
            }
        }
    }

    let mut jumpf = File::create(jump_file).unwrap();
    for jump in jumps {
        let _ = jumpf.write_all((jump.to_string() + "\n").as_bytes());
    }

    let mut idf = File::create(id_file).unwrap();
    for (id, syms) in id_table {
        for sym in syms {
            let components = split_scopes(&id);
            for i in 0..components.len() {
                let sub = &components[i..components.len()];
                let sub = sub.join("::");

                if !sub.is_empty() {
                    let line = format!("{} {}\n", sub, sym);
                    let _ = idf.write_all(line.as_bytes());
                }
            }
        }
    }
}
