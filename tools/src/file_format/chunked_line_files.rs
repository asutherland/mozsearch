use lz4_flex::block;
use std::fs::File;
use std::io::Cursor;

/// Writes a custom compressed file format that `ChunkedSemanticLineReader` can
/// understand that provides for efficient random access excerpts of text data
/// associated with "semantic" line numbers.
///
/// For a given searchfox indexed file, searchfox thinks about the file in terms
/// of the source file's line numbers and which we dub "semantic" line numbers
/// in this implementation.  But for the rendered HTML data or the analysis
/// records, we may actually have multiple lines of text for each semantic line.
pub struct ChunkedSemanticLineWriter {
    /// The buffer that can be used as a writer to write lines directly into.
    pub buffer: Vec<u8>,
    pub cur_one_based_line_num: u32,
    cur_line_start_offset: u32,
    buffer_zero_based_line_offset: u32,
    zero_based_line_offsets: Vec<u32>,
}

const LINES_PER_CHUNK: u32 = 32;

impl ChunkedSemanticLineWriter {
    pub fn new() -> Self {
        ChunkedSemanticLineWriter {
            buffer: Vec::with_capacity(16 * 1024),
            cur_one_based_line_num: 0,
            cur_line_start_offset: 0,
            buffer_zero_based_line_offset: 0,
            zero_based_line_offsets: vec![],
        }
    }

    pub fn mark_line_start(&mut self, one_based_line_num: u32) {
        if one_based_line_num < 1 {
            return;
        }

        let cur_offset = self.buffer.len();
        let zero_based_line_num = one_based_line_num - 1;

        // Push the current offset for any skipped lines as well.
        //
        // (It's not immediately clear what the implications of `resize` are on
        // our spare capacity, so I'm not using it.)
        while self.zero_based_line_offsets.len() <= zero_based_line_num {
            self.zero_based_line_offsets.push(cur_offset);
        }

        self.cur_one_based_line_num = one_based_line_num;
        self.cur_line_start_offset = cur_offset;
    }

    pub fn get_cur_line(&self) -> &[u8] {
        return &self.buffer[self.cur_line_start_offset..self.buffer.len()];
    }

    pub fn write_to_
}

pub struct ChunkedSemanticLineReader {
    f: File,
}

impl ChunkedSemanticLineReader {
    pub fn new(f: File) -> Self {
        Self {
            f,
        }
    }

    /// Return a string that includes content for the requested continuous
    /// semantic line range plus potentially extra content for lines you didn't
    /// ask for!  Your processing logic needs to be smart enough to figure out
    /// what the associated lines are.  Keep in mind that a single semantic line
    /// can end up spanning multiple syntactic lines because HTML and analysis
    /// records may span multiple lines.
    pub fn read_line_range(&mut self, first_one_based_line_inclusive: u32, last_one_based_line_inclusive: u32) -> String {
        let first_line_zero = start_one_based_line_inclusive - 1;
        let last_line_zero = last_one_based_line_inclusive - 1;
        let first_chunk = start_line_zero / LINES_PER_CHUNK;
        let last_chunk = last_line_zero / LINES_PER_CHUNK;

        // ## read the chunk position information entries

        // ## read the chunks
    }
}
