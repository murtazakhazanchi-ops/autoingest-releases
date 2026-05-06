%Image::ExifTool::UserDefined = (
    'Image::ExifTool::XMP::Main' => {
        ajs => {
            SubDirectory => {
                TagTable => 'Image::ExifTool::UserDefined::ajs',
            },
        },
    },
);

%Image::ExifTool::UserDefined::ajs = (
    GROUPS    => { 0 => 'XMP', 1 => 'XMP-ajs', 2 => 'Other' },
    NAMESPACE => { 'ajs' => 'https://aljamea-tus-saifiyah.edu/xmp/1.0/' },
    HijriDate => { Writable => 'string' },
);

1; # end
