use std::collections::HashMap;

use serde::{Deserialize};

#[derive(Deserialize)]
pub struct ChewRoot {
    pub doc: ChewBlock,
    #[serde(default)]
    pub templates: HashMap<String, ChewBlock>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChewBlock {
    Condition(ChewConditionBlock),

    Map(ChewMap),
    Seq(ChewSeq),

    Flatten(ChewScalar),
}

#[derive(Deserialize)]
pub enum ChewScalar {
    /// This scalar names a definition.  Definitions can potentially generate
    /// structured records, so are distinct from uses.
    Def(ChewScalarDef),
    /// This scalar names a use.
    Use(ChewScalarUse),
    /// This scalar is a relative path reference to another file to include and
    /// process (after path transformation).
    Include(ChewScalarInclude),
    /// This scalar references a file in the tree; generate a FILE use (after
    /// path transformation).  Differs from `ChewScalarUse` in that we expect
    /// the def/use to operate in a synthetic string namespace.
    FileRef(ChewFileRef),
}

#[derive(Deserialize)]
pub struct ChewMap {
    /// Individually handle specific keys
    #[serde(default)]
    pub specific: HashMap<String, ChewBlock>,
    /// After any "specific" definitions, handle keys this way.
    pub keys: Option<ChewScalar>,
    /// After any "specific" definitions, handle values this way.
    pub values: Option<Box<ChewBlock>>,
}

#[derive(Deserialize)]
pub struct ChewSeq {
    pub item: Option<Box<ChewBlock>>,
}

#[derive(Deserialize)]
pub struct ChewScalarDef {
    pub namespace: Option<String>,
    pub binding: Option<ChewBindingDescriptor>,
}

#[derive(Deserialize)]
pub struct ChewScalarUse {
    pub namespace: Option<String>
}

#[derive(Deserialize)]
pub struct ChewScalarInclude {
    pub path: Option<ChewStringBuilder>,
}

#[derive(Deserialize)]
pub struct ChewFileRef {
    pub path: Option<ChewStringBuilder>,
}

/// Build a binding descriptor that will be emitted as part of a structured
/// record which the crossref process can turn into a binding slot.  Binding
/// slots operate in terms of specific symbol identifiers whereas we expect that
/// most of our use-cases will only be able to generate a pretty identifier plus
/// potentially some metadata to potentially uniquely identify an overload.
#[derive(Deserialize)]
pub struct ChewBindingDescriptor {
    pub pretty: Option<ChewStringBuilder>,
}

/// Help build a string starting from the underlying scalar value.
///
/// Future options might include: prefix (append a prefix), suffix (append a
/// suffix), or similar, but for now liquid templating should be sufficient and
/// seems likely to be most readable.
#[derive(Deserialize)]
pub struct ChewStringBuilder {
    /// Evaluate a liquid template where the underlying scalar value is provided
    /// as "value".
    pub liquid: Option<String>,
}

#[derive(Deserialize)]
pub struct ChewConditionBlock {
    #[serde(default)]
    pub conditions: Vec<ChewCondition>,
}

#[derive(Deserialize)]
pub struct ChewCondition {
    /// Match if our block is a map and it has this key.
    pub key: Option<String>,
    /// In conjunction with Key, only match if the value is a scalar with this
    /// value.
    pub value: Option<String>,
    /// The template to apply if this condition matches.  Currently we stop
    /// checking conditions once we apply a template, but we optionally could
    /// check and apply more conditions in the future.
    pub template: String,
}
