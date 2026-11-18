/// Normalizes a user-entered gateway URL to the bare base, so we can append the
/// API paths ourselves. Strips a trailing slash and any trailing `/v1` or `/ui`
/// segments (in any order) — people often paste the LiteLLM web UI URL
/// (".../ui") or an OpenAI-style ".../v1" base.
pub fn normalize_base(base: &str) -> String {
    let mut value = base.trim().trim_end_matches('/').to_string();
    loop {
        let lower = value.to_lowercase();
        if lower.ends_with("/v1") || lower.ends_with("/ui") {
            value.truncate(value.len() - 3);
            value = value.trim_end_matches('/').to_string();
        } else {
            break;
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::normalize_base;

    #[test]
    fn entfernt_v1_und_schraegstrich() {
        assert_eq!(normalize_base("http://host:4000/v1/"), "http://host:4000");
    }

    #[test]
    fn laesst_adresse_ohne_v1_unveraendert() {
        assert_eq!(normalize_base("http://host:4000"), "http://host:4000");
    }

    #[test]
    fn entfernt_mehrere_schraegstriche() {
        assert_eq!(normalize_base("http://host:4000///"), "http://host:4000");
        assert_eq!(normalize_base("http://host:4000/v1//"), "http://host:4000");
    }
}
