use std::collections::HashMap;
use std::fmt;
use std::fs::File;
use std::io::BufRead;
use std::io::BufReader;

extern crate rustc_serialize;
use self::rustc_serialize::json::{as_json, Json, Object};

#[derive(Clone, Eq, PartialEq, PartialOrd, Ord, Debug)]
pub struct Location {
    pub lineno: u32,
    pub col_start: u32,
    pub col_end: u32,
}

impl fmt::Display for Location {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        if self.col_start == self.col_end {
            write!(
                formatter,
                r#""loc":"{:05}:{}""#,
                self.lineno, self.col_start
            )
        } else {
            write!(
                formatter,
                r#""loc":"{:05}:{}-{}""#,
                self.lineno, self.col_start, self.col_end
            )
        }
    }
}

#[derive(Eq, PartialEq, PartialOrd, Ord, Debug)]
pub struct LineRange {
    pub start_lineno: u32,
    pub end_lineno: u32,
}

#[derive(Eq, PartialEq, PartialOrd, Ord, Debug)]
pub struct SourceRange {
    pub start_lineno: u32,
    pub start_col: u32,
    pub end_lineno: u32,
    pub end_col: u32,
}

impl SourceRange {
    /// Union the other SourceRange into this SourceRange.
    pub fn union(&mut self, other: SourceRange) {
        // A start_lineno of 0 represents an empty/omitted range.  The range is best effort and
        // so one range might be empty and the other not.
        if other.start_lineno == 0 {
            // Nothing to do if the other range is empty.
            return;
        }
        if self.start_lineno == 0 {
            // Clobber this range with the other range if we were empty.
            self.start_lineno = other.start_lineno;
            self.start_col = other.start_col;
            self.end_lineno = other.end_lineno;
            self.end_col = other.end_col;
            return;
        }

        if other.start_lineno < self.start_lineno {
            self.start_lineno = other.start_lineno;
            self.start_col = other.start_col;
        } else if other.start_lineno == self.start_lineno && other.start_col < self.start_col {
            self.start_col = other.start_col;
        }

        if other.end_lineno > self.end_lineno {
            self.end_lineno = other.end_lineno;
            self.end_col = other.end_col;
        } else if other.end_lineno == self.end_lineno && other.end_col > self.end_col {
            self.end_col = other.end_col;
        }
    }
}

#[derive(Debug)]
pub struct WithLocation<T> {
    pub data: T,
    pub loc: Location,
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum AnalysisKind {
    Use,
    Def,
    Assign,
    Decl,
    Idl,
    IPC,
}

impl fmt::Display for AnalysisKind {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        let str = match self {
            AnalysisKind::Use => "use",
            AnalysisKind::Def => "def",
            AnalysisKind::Assign => "assign",
            AnalysisKind::Decl => "decl",
            AnalysisKind::Idl => "idl",
            AnalysisKind::IPC => "ipc",
        };
        formatter.write_str(str)
    }
}

#[derive(Debug)]
pub struct AnalysisTarget {
    pub kind: AnalysisKind,
    pub pretty: String,
    pub sym: String,
    pub context: String,
    pub contextsym: String,
    pub peek_range: LineRange,
}

impl fmt::Display for AnalysisTarget {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        write!(
            formatter,
            r#""target":1,"kind":"{}","pretty":{},"sym":{}"#,
            self.kind,
            as_json(&self.pretty),
            as_json(&self.sym)
        )?;
        if !self.context.is_empty() {
            write!(formatter, r#","context":{}"#, as_json(&self.context))?;
        }
        if !self.contextsym.is_empty() {
            write!(formatter, r#","contextsym":{}"#, as_json(&self.contextsym))?;
        }
        if self.peek_range.start_lineno != 0 || self.peek_range.end_lineno != 0 {
            write!(
                formatter,
                r#","peekRange":"{}-{}""#,
                self.peek_range.start_lineno, self.peek_range.end_lineno
            )?;
        }
        Ok(())
    }
}

impl fmt::Display for WithLocation<AnalysisTarget> {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        write!(formatter, "{{{},{}}}", self.loc, self.data)
    }
}

#[derive(Debug)]
pub struct AnalysisSource {
    pub syntax: Vec<String>,
    pub pretty: String,
    pub sym: Vec<String>,
    pub no_crossref: bool,
    pub nesting_range: SourceRange,
    /// For records that have an associated type (and aren't a type), this is the human-readable
    /// representation of the type that may have all kinds of qualifiers that searchfox otherwise
    /// ignores.  Not all records will have this type.
    pub type_pretty: Option<String>,
    /// For records that have an associated type, we may be able to map the type to a searchfox
    /// symbol, and if so, this is that.  Even if the record has a `type_pretty`, it may not have a
    /// type_sym.
    pub type_sym: Option<String>,
    // XXX maybe there should be an Option<AnalysisMeta> here and we only attach it to definitions?
    // Perhaps source records are the wrong thing here.
    pub src_sym: Option<String>,
    pub target_sym: Option<String>,
}

impl AnalysisSource {
    /// Merges the `syntax`, `sym`, `no_crossref`, and `nesting_range` fields from `other`
    /// into `self`. The `no_crossref` field can be different sometimes
    /// with different versions of clang being used across different
    /// platforms; in this case we only set `no_crossref` if all the versions
    /// being merged have the `no_crossref` field set.  The `nesting_range` can
    /// vary due to use of the pre-processor, including an extreme case where the
    /// ranges are non-overlapping.  We choose to union these ranges because
    /// `merge-analyses.rs` only merges adjacent source entries so the space
    /// between the ranges should simply be preprocessor directives.
    ///
    /// Also asserts that the `pretty` field is the same because otherwise
    /// the merge doesn't really make sense.
    pub fn merge(&mut self, mut other: AnalysisSource) {
        assert_eq!(self.pretty, other.pretty);
        self.no_crossref &= other.no_crossref;
        self.syntax.append(&mut other.syntax);
        self.syntax.sort();
        self.syntax.dedup();
        self.sym.append(&mut other.sym);
        self.sym.sort();
        self.sym.dedup();
        self.nesting_range.union(other.nesting_range);
        // We regrettably have no guarantee that the types are the same, so just pick a type when
        // we have it.
        // I tried to make this idiomatic using "or" to overwrite the type, but it got ugly.
        if let Some(type_pretty) = other.type_pretty {
            self.type_pretty.get_or_insert(type_pretty);
        }
        if let Some(type_sym) = other.type_sym {
            self.type_sym.get_or_insert(type_sym);
        }
        if let Some(src_sym) = other.src_sym {
            self.src_sym.get_or_insert(src_sym);
        }
        if let Some(target_sym) = other.target_sym {
            self.target_sym.get_or_insert(target_sym);
        }
    }

    /// Indicates whether this is a "def" or not.  Note that this is determined by consulting the
    /// `syntax` which is empty for locals (where no_crossref=true).  If you really care if
    /// something is a def or not, you might want a target record (which always has a kind) or a
    /// new type of record.
    pub fn is_def(&self) -> bool {
        return self.syntax.contains(&String::from("def"));
    }

    /// Indicate whether this is a synthetic IPC symbol that needs to habe its meta-info
    /// propagated during cross-referencing.
    pub fn is_ipc(&self) -> bool {
        return self.pretty.split(' ').next().map_or(false, |kind| kind == "ipc");
    }

    /// Returns true if there's any meta-info of note on this record.
    pub fn has_meta_info(&self) -> bool {
        self.type_pretty.is_some() ||
        self.type_sym.is_some() ||
        self.src_sym.is_some() ||
        self.target_sym.is_some()
    }

    /// Source records' "pretty" field is prefixed with their SyntaxKind.  It's also placed in the
    /// "syntax" sorted array, but that string/array ends up empty when no_crossref is set, so
    /// it's currently easiest to get it from here.
    ///
    /// XXX note that the clang indexer can generate "enum constant" syntax kinds that possess a
    /// space, but that just means we lose the "constant" bit, not that we get confused about the
    /// pretty name.
    pub fn get_syntax_kind(&self) -> Option<&str> {
        // It's a given that we're using a standard ASCII space character.
        return self.pretty.split(' ').next();
    }
}

impl fmt::Display for AnalysisSource {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        write!(
            formatter,
            r#""source":1,"syntax":{},"pretty":{},"sym":{}"#,
            as_json(&self.syntax.join(",")),
            as_json(&self.pretty),
            as_json(&self.sym.join(","))
        )?;
        if self.no_crossref {
            write!(formatter, r#","no_crossref":1"#)?;
        }
        if self.nesting_range.start_lineno != 0 {
            write!(
                formatter,
                r#","nestingRange":"{}:{}-{}:{}""#,
                self.nesting_range.start_lineno,
                self.nesting_range.start_col,
                self.nesting_range.end_lineno,
                self.nesting_range.end_col
            )?;
        }
        if let Some(type_pretty) = &self.type_pretty {
            write!(
                formatter,
                r#","type":"{}""#,
                type_pretty
            )?;
        }
        if let Some(type_sym) = &self.type_sym {
            write!(
                formatter,
                r#","typesym":"{}""#,
                type_sym
            )?;
        }
        if let Some(src_sym) = &self.src_sym {
            write!(
                formatter,
                r#","srcsym":"{}""#,
                src_sym
            )?;
        }
        if let Some(target_sym) = &self.target_sym {
            write!(
                formatter,
                r#","targetsym":"{}""#,
                target_sym
            )?;
        }
        Ok(())
    }
}

impl fmt::Display for WithLocation<AnalysisSource> {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        write!(formatter, "{{{},{}}}", self.loc, self.data)
    }
}

impl fmt::Display for WithLocation<Vec<AnalysisSource>> {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        let locstr = format!("{}", self.loc);
        for src in &self.data {
            writeln!(formatter, "{{{},{}}}", locstr, src)?;
        }
        Ok(())
    }
}

pub fn parse_location(loc: &str) -> Location {
    let v: Vec<&str> = loc.split(":").collect();
    let lineno = v[0].parse::<u32>().unwrap();
    let (col_start, col_end) = if v[1].contains("-") {
        let v: Vec<&str> = v[1].split("-").collect();
        (v[0], v[1])
    } else {
        (v[1], v[1])
    };
    let col_start = col_start.parse::<u32>().unwrap();
    let col_end = col_end.parse::<u32>().unwrap();
    Location {
        lineno: lineno,
        col_start: col_start,
        col_end: col_end,
    }
}

fn parse_line_range(range: &str) -> LineRange {
    let v: Vec<&str> = range.split("-").collect();
    let start_lineno = v[0].parse::<u32>().unwrap();
    let end_lineno = v[1].parse::<u32>().unwrap();
    LineRange {
        start_lineno: start_lineno,
        end_lineno: end_lineno,
    }
}

fn parse_source_range(range: &str) -> SourceRange {
    let v: Vec<&str> = range.split(&['-', ':'][..]).collect();
    let start_lineno = v[0].parse::<u32>().unwrap();
    let start_col = v[1].parse::<u32>().unwrap();
    let end_lineno = v[2].parse::<u32>().unwrap();
    let end_col = v[3].parse::<u32>().unwrap();
    SourceRange {
        start_lineno,
        start_col,
        end_lineno,
        end_col,
    }
}

pub fn read_analysis<T>(
    filename: &str,
    filter: &mut dyn FnMut(&Object) -> Option<T>,
) -> Vec<WithLocation<Vec<T>>> {
    read_analyses(vec![filename.to_string()].as_slice(), filter)
}

/// Load analysis data for one or more files, sorting and grouping by location, with data payloads
/// transformed via the provided `filter`, resulting in either AnalysisSource records being
/// returned (if `read_source` is provided) or AnalysisTarget (if `read_target`) and other record
/// types being ignored.
pub fn read_analyses<T>(
    filenames: &[String],
    filter: &mut dyn FnMut(&Object) -> Option<T>,
) -> Vec<WithLocation<Vec<T>>> {
    let mut result = Vec::new();
    for filename in filenames {
        let file = match File::open(filename) {
            Ok(f) => f,
            Err(_) => {
                warn!("Error trying to open analysis file [{}]", filename);
                continue;
            }
        };
        let reader = BufReader::new(&file);
        let mut lineno = 0;
        for line in reader.lines() {
            let line = line.unwrap();
            lineno += 1;
            let data = Json::from_str(&line);
            let data = match data {
                Ok(data) => data,
                Err(e) => {
                    warn!(
                        "Error [{}] trying to read analysis from file [{}] line [{}]: [{}]",
                        e, filename, lineno, &line
                    );
                    continue;
                }
            };
            let obj = data.as_object().unwrap();
            match filter(obj) {
                Some(v) => {
                    let loc = parse_location(obj.get("loc").unwrap().as_string().unwrap());
                    result.push(WithLocation { data: v, loc: loc })
                }
                None => {}
            }
        }
    }

    result.sort_by(|x1, x2| x1.loc.cmp(&x2.loc));

    let mut result2 = Vec::new();
    let mut last_loc = None;
    let mut last_vec = Vec::new();
    for r in result {
        match last_loc {
            Some(ll) => {
                if ll == r.loc {
                    last_loc = Some(ll);
                } else {
                    result2.push(WithLocation {
                        loc: ll,
                        data: last_vec,
                    });
                    last_vec = Vec::new();
                    last_loc = Some(r.loc);
                }
            }
            None => {
                last_loc = Some(r.loc);
            }
        }
        last_vec.push(r.data);
    }

    match last_loc {
        Some(ll) => result2.push(WithLocation {
            loc: ll,
            data: last_vec,
        }),
        None => {}
    }

    result2
}

pub fn read_target(obj: &Object) -> Option<AnalysisTarget> {
    if !obj.contains_key("target") {
        return None;
    }

    let kindstr = obj.get("kind").unwrap().as_string().unwrap();
    let kind = match kindstr {
        "use" => AnalysisKind::Use,
        "def" => AnalysisKind::Def,
        "assign" => AnalysisKind::Assign,
        "decl" => AnalysisKind::Decl,
        "idl" => AnalysisKind::Idl,
        "ipc" => AnalysisKind::IPC,
        _ => panic!("bad target kind"),
    };

    let pretty = match obj.get("pretty") {
        Some(json) => json.as_string().unwrap().to_string(),
        None => "".to_string(),
    };
    let context = match obj.get("context") {
        Some(json) => json.as_string().unwrap().to_string(),
        None => "".to_string(),
    };
    let contextsym = match obj.get("contextsym") {
        Some(json) => json.as_string().unwrap().to_string(),
        None => "".to_string(),
    };
    let peek_range = match obj.get("peekRange") {
        Some(json) => parse_line_range(json.as_string().unwrap()),
        None => LineRange {
            start_lineno: 0,
            end_lineno: 0,
        },
    };
    let sym = obj.get("sym").unwrap().as_string().unwrap().to_string();

    Some(AnalysisTarget {
        kind: kind,
        pretty: pretty,
        sym: sym,
        context: context,
        contextsym: contextsym,
        peek_range: peek_range,
    })
}

pub fn read_source(obj: &Object) -> Option<AnalysisSource> {
    if !obj.contains_key("source") {
        return None;
    }

    let syntax = match obj.get("syntax") {
        Some(json) => json.as_string().unwrap().to_string(),
        None => "".to_string(),
    };
    let mut syntax: Vec<String> = syntax.split(',').map(str::to_string).collect();
    syntax.sort();
    syntax.dedup();

    let pretty = match obj.get("pretty") {
        Some(json) => json.as_string().unwrap().to_string(),
        None => "".to_string(),
    };
    let mut sym: Vec<String> = obj
        .get("sym")
        .unwrap()
        .as_string()
        .unwrap()
        .to_string()
        .split(',')
        .map(str::to_string)
        .collect();
    sym.sort();
    sym.dedup();

    let no_crossref = match obj.get("no_crossref") {
        Some(_) => true,
        None => false,
    };

    let nesting_range = match obj.get("nestingRange") {
        Some(json) => parse_source_range(json.as_string().unwrap()),
        None => SourceRange {
            start_lineno: 0,
            start_col: 0,
            end_lineno: 0,
            end_col: 0,
        },
    };

    // We need to go from Option<Json> to Option<String>.
    let to_str_opt = |oj: &Option<&Json>| match oj {
        Some(j) => Some(j.as_string().unwrap().to_string()),
        None => None
    };

    let type_pretty = to_str_opt(&obj.get("type"));
    let type_sym = to_str_opt(&obj.get("typesym"));
    let src_sym = to_str_opt(&obj.get("srcsym"));
    let target_sym = to_str_opt(&obj.get("targetsym"));

    Some(AnalysisSource {
        pretty,
        sym,
        syntax,
        no_crossref,
        nesting_range,
        type_pretty,
        type_sym,
        src_sym,
        target_sym,
    })
}

pub struct Jump {
    pub id: String,
    pub path: String,
    pub lineno: u64,
    pub pretty: String,
}

pub fn read_jumps(filename: &str) -> HashMap<String, Jump> {
    let file = File::open(filename).unwrap();
    let reader = BufReader::new(&file);
    let mut result = HashMap::new();
    let mut lineno = 1;
    for line in reader.lines() {
        let line = line.unwrap();
        let data = Json::from_str(&line);
        let data = match data {
            Ok(data) => data,
            Err(_) => panic!("error on line {}: {}", lineno, &line),
        };
        lineno += 1;

        let array = data.as_array().unwrap();
        let id = array[0].as_string().unwrap().to_string();
        let data = Jump {
            id: id.clone(),
            path: array[1].as_string().unwrap().to_string(),
            lineno: array[2].as_u64().unwrap(),
            pretty: array[3].as_string().unwrap().to_string(),
        };

        result.insert(id, data);
    }
    result
}
